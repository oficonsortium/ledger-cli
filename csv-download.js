#!/usr/bin/env node
/**
 * csv-download.js - Download Open Collective transaction CSVs
 *
 * Downloads transaction CSV files from the Open Collective REST API,
 * batched by day and organized into a folder structure.
 *
 * USAGE
 * =====
 *
 *     ofi-csv-download ofitech
 *     ofi-csv-download ofitech --host
 *     ofi-csv-download ofitech --from 2024-01-01 --to 2024-12-31
 *     ofi-csv-download ofitech --days 7
 *     ofi-csv-download ofitech --replace
 *
 * AUTHENTICATION (optional)
 * =========================
 *
 * Set PERSONAL_TOKEN in a .env file or as an environment variable
 * to access private account data. Public data works without a token.
 * Generate a token at https://opencollective.com/applications
 */

import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

// =============================================================================
// Configuration
// =============================================================================

const REST_BASE_URL = 'https://rest.opencollective.com/v2';

// CSV fields to request (stored as a clean object, rebuilt into URL when needed)
const CSV_FIELDS = [
  'datetime',
  'effectiveDate',
  'legacyId',
  'description',
  'type',
  'kind',
  'group',
  'netAmount',
  'currency',
  'isReverse',
  'isReversed',
  'reverseLegacyId',
  'accountSlug',
  'accountName',
  'oppositeAccountSlug',
  'oppositeAccountName',
  'paymentMethodService',
  'paymentMethodType',
  'orderMemo',
  'expenseType',
  'expenseTags',
  'payoutMethodType',
  'accountingCategoryCode',
  'accountingCategoryName',
  'merchantId',
  'reverseKind',
  'accountType',
  'oppositeAccountType',
  'parentAccountSlug',
  'parentAccountType',
  'oppositeParentAccountSlug',
  'oppositeParentAccountType',
  'paymentProcessorFee',
  'taxAmount',
  'hostFee',
  'platformFee',
];

// Default query parameters
const DEFAULT_PARAMS = {
  includeGiftCardTransactions: '1',
  includeIncognitoTransactions: '1',
  includeChildrenTransactions: '1',
  useFieldNames: '1',
  'orderBy[field]': 'createdAt',
  'orderBy[direction]': 'ASC',
};

// Pagination settings
const PAGE_LIMIT = 1000;

// =============================================================================
// Date Utilities
// =============================================================================

/**
 * Parse a date string (YYYY-MM-DD) into a Date object at midnight UTC.
 */
function parseDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Format a Date object as YYYY-MM-DD.
 */
function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a Date object as ISO 8601 string for requests.
 */
function formatISODate(date) {
  return date.toISOString();
}

/**
 * Get yesterday's date (end of range default).
 */
function getYesterday() {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return yesterday;
}

/**
 * Get today's date.
 */
function getToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Check if a date is today.
 */
function isToday(date) {
  const today = getToday();
  return formatDate(date) === formatDate(today);
}

/**
 * Generate an array of dates from start to end (inclusive), going backwards.
 */
function generateDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(endDate);

  while (current >= startDate) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() - 1);
  }

  return dates;
}

/**
 * Generate an array of month ranges from start to end (inclusive), going backwards.
 * Each entry has { start, end } covering a full month (clamped to startDate/endDate).
 */
function generateMonthRange(startDate, endDate) {
  const months = [];
  // Start from the month of endDate, go backwards
  let current = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));

  while (current >= new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))) {
    // Month start: first day of month, or startDate if in same month
    const monthStart =
      current.getUTCFullYear() === startDate.getUTCFullYear() && current.getUTCMonth() === startDate.getUTCMonth()
        ? new Date(startDate)
        : new Date(current);

    // Month end: last day of month, or endDate if in same month
    const lastDayOfMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
    const monthEnd =
      current.getUTCFullYear() === endDate.getUTCFullYear() && current.getUTCMonth() === endDate.getUTCMonth()
        ? new Date(endDate)
        : lastDayOfMonth;

    months.push({ start: monthStart, end: monthEnd });

    // Move to previous month
    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
  }

  return months;
}

/**
 * Generate an array of year ranges from start to end (inclusive), going backwards.
 * Each entry has { start, end } covering a full year (clamped to startDate/endDate).
 */
function generateYearRange(startDate, endDate) {
  const years = [];
  // Start from the year of endDate, go backwards
  let current = new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1));

  while (current >= new Date(Date.UTC(startDate.getUTCFullYear(), 0, 1))) {
    // Year start: Jan 1, or startDate if in same year
    const yearStart = current.getUTCFullYear() === startDate.getUTCFullYear() ? new Date(startDate) : new Date(current);

    // Year end: Dec 31, or endDate if in same year
    const lastDayOfYear = new Date(Date.UTC(current.getUTCFullYear(), 11, 31));
    const yearEnd = current.getUTCFullYear() === endDate.getUTCFullYear() ? new Date(endDate) : lastDayOfYear;

    years.push({ start: yearStart, end: yearEnd });

    // Move to previous year
    current = new Date(Date.UTC(current.getUTCFullYear() - 1, 0, 1));
  }

  return years;
}

// =============================================================================
// File System Utilities
// =============================================================================

/**
 * Build the output file path for a given date.
 * Format: SLUG/YYYY/MM/SLUG-YYYY-MM-DD-transactions.csv
 * Or with page: SLUG/YYYY/MM/SLUG-YYYY-MM-DD-transactions-001.csv
 */
function buildFilePath(slug, date, page = null) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  const pageSuffix = page !== null ? `-${String(page).padStart(3, '0')}` : '';
  return path.join(slug, String(year), month, `${slug}-${year}-${month}-${day}-transactions${pageSuffix}.csv`);
}

/**
 * Build the output file path for a given month.
 * Format: SLUG/YYYY/SLUG-YYYY-MM-transactions.csv
 * Or with page: SLUG/YYYY/SLUG-YYYY-MM-transactions-001.csv
 */
function buildMonthlyFilePath(slug, date, page = null) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  const pageSuffix = page !== null ? `-${String(page).padStart(3, '0')}` : '';
  return path.join(slug, String(year), `${slug}-${year}-${month}-transactions${pageSuffix}.csv`);
}

/**
 * Build the output file path for a given year.
 * Format: SLUG/YYYY/SLUG-YYYY-transactions.csv
 * Or with page: SLUG/YYYY/SLUG-YYYY-transactions-001.csv
 */
function buildYearlyFilePath(slug, date, page = null) {
  const year = date.getUTCFullYear();

  const pageSuffix = page !== null ? `-${String(page).padStart(3, '0')}` : '';
  return path.join(slug, String(year), `${slug}-${year}-transactions${pageSuffix}.csv`);
}

/**
 * Ensure the directory for a file path exists.
 */
function ensureDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Check if a file exists.
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// =============================================================================
// REST Utilities
// =============================================================================

/**
 * Build the REST URL for fetching transactions for a specific date or date range.
 * @param {string} slug - Account slug
 * @param {Date} date - Date to fetch (used for single-day range if dateFrom/dateTo not provided)
 * @param {boolean} isHost - Whether to use hostTransactions endpoint
 * @param {object} options - Additional options
 * @param {number} options.limit - Max records to return
 * @param {number} options.offset - Records to skip
 * @param {Date} options.dateFrom - Explicit range start (overrides date)
 * @param {Date} options.dateTo - Explicit range end (overrides date)
 */
function buildRestUrl(slug, date, isHost, options = {}) {
  const endpoint = isHost ? 'hostTransactions.csv' : 'transactions.csv';
  const url = new URL(`${REST_BASE_URL}/${slug}/${endpoint}`);

  // Add default parameters
  for (const [key, value] of Object.entries(DEFAULT_PARAMS)) {
    url.searchParams.set(key, value);
  }

  // Add pagination parameters
  if (options.limit !== undefined) {
    url.searchParams.set('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    url.searchParams.set('offset', String(options.offset));
  }

  // Add fields
  url.searchParams.set('fields', CSV_FIELDS.join(','));

  // Add date range
  if (options.dateFrom && options.dateTo) {
    // Explicit date range (e.g., monthly strategy)
    const rangeStart = new Date(options.dateFrom);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(options.dateTo);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    url.searchParams.set('dateFrom', formatISODate(rangeStart));
    url.searchParams.set('dateTo', formatISODate(rangeEnd));
  } else {
    // Single day range (default)
    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);

    const dayEnd = new Date(date);
    dayEnd.setUTCHours(23, 59, 59, 999);

    url.searchParams.set('dateFrom', formatISODate(dayStart));
    url.searchParams.set('dateTo', formatISODate(dayEnd));
  }

  return url.toString();
}

/**
 * Fetch the total count of transactions for a specific date using HEAD request.
 * @returns {Promise<number>} Total count from X-Exported-Rows header
 */
async function fetchCount(slug, date, isHost, token) {
  const url = buildRestUrl(slug, date, isHost);

  const response = await fetch(url, {
    method: 'HEAD',
    headers: {
      ...(token && { PersonalToken: token }),
    },
  });

  if (!response.ok) {
    throw new Error(`HEAD request failed (${response.status})`);
  }

  const totalCount = parseInt(response.headers.get('X-Exported-Rows') || '0', 10);
  return totalCount;
}

/**
 * Fetch CSV data from the REST endpoint for a specific date.
 * @param {string} slug - Account slug
 * @param {Date} date - Date to fetch
 * @param {boolean} isHost - Whether to use hostTransactions endpoint
 * @param {string} token - Personal token
 * @param {object} options - Pagination options
 * @param {number} options.limit - Max records to return
 * @param {number} options.offset - Records to skip
 */
async function fetchCsv(slug, date, isHost, token, options = {}) {
  const url = buildRestUrl(slug, date, isHost, {
    limit: options.limit,
    offset: options.offset,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
  });

  const response = await fetch(url, {
    headers: {
      ...(token && { PersonalToken: token }),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }

  return response.text();
}

/**
 * Count data rows (excluding header) in a CSV file.
 */
function countCsvRows(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');
  return lines.length - 1;
}

// =============================================================================
// Download Logic
// =============================================================================

/**
 * Count how many paginated files exist for a date.
 * Returns 0 if no paginated files exist.
 */
function countExistingPages(slug, date) {
  let count = 0;
  for (let page = 1; page <= 999; page++) {
    if (fileExists(buildFilePath(slug, date, page))) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Check if all pages exist for a given total count.
 */
function allPagesExist(slug, date, totalCount) {
  const expectedPages = Math.ceil(totalCount / PAGE_LIMIT);
  if (expectedPages <= 1) {
    // Single page day - check non-paginated file
    return fileExists(buildFilePath(slug, date));
  }
  // Multi-page day - check all numbered files exist
  return countExistingPages(slug, date) >= expectedPages;
}

/**
 * Delete existing files for a date (both paginated and non-paginated).
 */
function deleteExistingFiles(slug, date) {
  // Delete non-paginated file if exists
  const singleFilePath = buildFilePath(slug, date);
  if (fileExists(singleFilePath)) {
    fs.unlinkSync(singleFilePath);
  }

  // Delete any paginated files
  for (let page = 1; page <= 999; page++) {
    const pageFilePath = buildFilePath(slug, date, page);
    if (fileExists(pageFilePath)) {
      fs.unlinkSync(pageFilePath);
    } else {
      break; // No more pages
    }
  }
}

/**
 * Fetch the total count of transactions for a month range using HEAD request.
 * @returns {Promise<number>} Total count from X-Exported-Rows header
 */
async function fetchMonthCount(slug, month, isHost, token) {
  const url = buildRestUrl(slug, month.start, isHost, { dateFrom: month.start, dateTo: month.end });

  const response = await fetch(url, {
    method: 'HEAD',
    headers: {
      ...(token && { PersonalToken: token }),
    },
  });

  if (!response.ok) {
    throw new Error(`HEAD request failed (${response.status})`);
  }

  const totalCount = parseInt(response.headers.get('X-Exported-Rows') || '0', 10);
  return totalCount;
}

/**
 * Count how many paginated files exist for a month.
 */
function countExistingMonthPages(slug, date) {
  let count = 0;
  for (let page = 1; page <= 999; page++) {
    if (fileExists(buildMonthlyFilePath(slug, date, page))) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Check if all pages exist for a given month total count.
 */
function allMonthPagesExist(slug, date, totalCount) {
  const expectedPages = Math.ceil(totalCount / PAGE_LIMIT);
  if (expectedPages <= 1) {
    return fileExists(buildMonthlyFilePath(slug, date));
  }
  return countExistingMonthPages(slug, date) >= expectedPages;
}

/**
 * Delete existing files for a month (both paginated and non-paginated).
 */
function deleteExistingMonthFiles(slug, date) {
  const singleFilePath = buildMonthlyFilePath(slug, date);
  if (fileExists(singleFilePath)) {
    fs.unlinkSync(singleFilePath);
  }

  for (let page = 1; page <= 999; page++) {
    const pageFilePath = buildMonthlyFilePath(slug, date, page);
    if (fileExists(pageFilePath)) {
      fs.unlinkSync(pageFilePath);
    } else {
      break;
    }
  }
}

/**
 * Fetch the total count of transactions for a year range using HEAD request.
 * @returns {Promise<number>} Total count from X-Exported-Rows header
 */
async function fetchYearCount(slug, year, isHost, token) {
  const url = buildRestUrl(slug, year.start, isHost, { dateFrom: year.start, dateTo: year.end });

  const response = await fetch(url, {
    method: 'HEAD',
    headers: {
      ...(token && { PersonalToken: token }),
    },
  });

  if (!response.ok) {
    throw new Error(`HEAD request failed (${response.status})`);
  }

  const totalCount = parseInt(response.headers.get('X-Exported-Rows') || '0', 10);
  return totalCount;
}

/**
 * Count how many paginated files exist for a year.
 */
function countExistingYearPages(slug, date) {
  let count = 0;
  for (let page = 1; page <= 999; page++) {
    if (fileExists(buildYearlyFilePath(slug, date, page))) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Delete existing files for a year (both paginated and non-paginated).
 */
function deleteExistingYearFiles(slug, date) {
  const singleFilePath = buildYearlyFilePath(slug, date);
  if (fileExists(singleFilePath)) {
    fs.unlinkSync(singleFilePath);
  }

  for (let page = 1; page <= 999; page++) {
    const pageFilePath = buildYearlyFilePath(slug, date, page);
    if (fileExists(pageFilePath)) {
      fs.unlinkSync(pageFilePath);
    } else {
      break;
    }
  }
}

/**
 * Download transactions for a single year, handling pagination.
 * @returns {{ downloaded: number, empty: boolean, error: string|null }}
 */
async function downloadYearTransactions(slug, year, options) {
  const { token, isHost, delayMs } = options;

  // Get total count first
  const totalCount = await fetchYearCount(slug, year, isHost, token);

  if (totalCount === 0) {
    return { downloaded: 0, empty: true, error: null };
  }

  const pageCount = Math.ceil(totalCount / PAGE_LIMIT);
  let downloadedFiles = 0;

  // Delete existing files before downloading
  deleteExistingYearFiles(slug, year.start);

  for (let page = 1; page <= pageCount; page++) {
    const offset = (page - 1) * PAGE_LIMIT;
    const filePath =
      pageCount === 1 ? buildYearlyFilePath(slug, year.start) : buildYearlyFilePath(slug, year.start, page);

    let csvContent = await fetchCsv(slug, year.start, isHost, token, {
      limit: PAGE_LIMIT,
      offset,
      dateFrom: year.start,
      dateTo: year.end,
    });

    // Check for API error appended to response
    if (csvContent.includes('\nError while fetching account transactions')) {
      throw new Error(`API error during download of page ${page}`);
    }

    // Check for and strip warning line
    const hasWarning = csvContent.includes('\nWarning: totalCount is ');
    if (hasWarning) {
      csvContent = csvContent.replace(/\nWarning: totalCount is .+$/, '');
    }

    // For first page, check if there's actually data
    const lines = csvContent.trim().split('\n');
    if (page === 1 && lines.length <= 1) {
      return { downloaded: 0, empty: true, error: null };
    }

    const rowCount = lines.length - 1;
    const expectedRows = Math.min(PAGE_LIMIT, totalCount - offset);

    if (rowCount !== expectedRows) {
      console.warn(`    WARNING: Page ${page} has ${rowCount} rows, expected ${expectedRows}`);
    }

    ensureDirectory(filePath);
    fs.writeFileSync(filePath, csvContent);
    downloadedFiles++;
    if (pageCount > 1) {
      console.log(`    Page ${page}/${pageCount}: ${rowCount} rows -> ${filePath}`);
    }

    if (page < pageCount) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { downloaded: downloadedFiles, empty: false, error: null, totalCount, pageCount };
}

/**
 * Download transactions for a single month, handling pagination.
 * @returns {{ downloaded: number, empty: boolean, error: string|null }}
 */
async function downloadMonthTransactions(slug, month, options) {
  const { token, isHost, delayMs } = options;

  // Get total count first
  const totalCount = await fetchMonthCount(slug, month, isHost, token);

  if (totalCount === 0) {
    return { downloaded: 0, empty: true, error: null };
  }

  const pageCount = Math.ceil(totalCount / PAGE_LIMIT);
  let downloadedFiles = 0;

  // Delete existing files before downloading
  deleteExistingMonthFiles(slug, month.start);

  for (let page = 1; page <= pageCount; page++) {
    const offset = (page - 1) * PAGE_LIMIT;
    const filePath =
      pageCount === 1 ? buildMonthlyFilePath(slug, month.start) : buildMonthlyFilePath(slug, month.start, page);

    let csvContent = await fetchCsv(slug, month.start, isHost, token, {
      limit: PAGE_LIMIT,
      offset,
      dateFrom: month.start,
      dateTo: month.end,
    });

    // Check for API error appended to response
    if (csvContent.includes('\nError while fetching account transactions')) {
      throw new Error(`API error during download of page ${page}`);
    }

    // Check for and strip warning line
    const hasWarning = csvContent.includes('\nWarning: totalCount is ');
    if (hasWarning) {
      csvContent = csvContent.replace(/\nWarning: totalCount is .+$/, '');
    }

    // For first page, check if there's actually data
    const lines = csvContent.trim().split('\n');
    if (page === 1 && lines.length <= 1) {
      return { downloaded: 0, empty: true, error: null };
    }

    const rowCount = lines.length - 1;
    const expectedRows = Math.min(PAGE_LIMIT, totalCount - offset);

    if (rowCount !== expectedRows) {
      console.warn(`    WARNING: Page ${page} has ${rowCount} rows, expected ${expectedRows}`);
    }

    ensureDirectory(filePath);
    fs.writeFileSync(filePath, csvContent);
    downloadedFiles++;
    if (pageCount > 1) {
      console.log(`    Page ${page}/${pageCount}: ${rowCount} rows -> ${filePath}`);
    }

    if (page < pageCount) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { downloaded: downloadedFiles, empty: false, error: null, totalCount, pageCount };
}

/**
 * Download transactions for a single date, handling pagination.
 * @returns {{ downloaded: number, empty: boolean, error: string|null }}
 */
async function downloadDateTransactions(slug, date, options) {
  const { token, isHost, delayMs } = options;
  const dateStr = formatDate(date);

  // Get total count first
  const totalCount = await fetchCount(slug, date, isHost, token);

  if (totalCount === 0) {
    return { downloaded: 0, empty: true, error: null };
  }

  const pageCount = Math.ceil(totalCount / PAGE_LIMIT);
  let downloadedFiles = 0;

  // Delete existing files before downloading (to handle count changes)
  deleteExistingFiles(slug, date);

  for (let page = 1; page <= pageCount; page++) {
    const offset = (page - 1) * PAGE_LIMIT;
    const filePath = pageCount === 1 ? buildFilePath(slug, date) : buildFilePath(slug, date, page);

    let csvContent = await fetchCsv(slug, date, isHost, token, {
      limit: PAGE_LIMIT,
      offset,
    });

    // Check for API error appended to response (happens when API fails mid-stream)
    if (csvContent.includes('\nError while fetching account transactions')) {
      throw new Error(`API error during download of page ${page}`);
    }

    // Check for and strip warning line added by API when totalCount > limit
    const hasWarning = csvContent.includes('\nWarning: totalCount is ');
    if (hasWarning) {
      csvContent = csvContent.replace(/\nWarning: totalCount is .+$/, '');
    }

    // For first page, check if there's actually data
    const lines = csvContent.trim().split('\n');
    if (page === 1 && lines.length <= 1) {
      return { downloaded: 0, empty: true, error: null };
    }

    const rowCount = lines.length - 1; // Exclude header
    const expectedRows = Math.min(PAGE_LIMIT, totalCount - offset);

    if (rowCount !== expectedRows) {
      console.warn(`    WARNING: Page ${page} has ${rowCount} rows, expected ${expectedRows}`);
    }

    // Ensure directory exists and write file
    ensureDirectory(filePath);
    fs.writeFileSync(filePath, csvContent);
    downloadedFiles++;
    if (pageCount > 1) {
      console.log(`    Page ${page}/${pageCount}: ${rowCount} rows -> ${filePath}`);
    }

    // Small delay between pages to avoid rate limiting
    if (page < pageCount) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { downloaded: downloadedFiles, empty: false, error: null, totalCount, pageCount };
}

/**
 * Download transactions for a date range using daily strategy.
 */
async function downloadTransactionsDaily(slug, startDate, endDate, options) {
  const { token, isHost, replace, dryRun, delayMs } = options;

  const dates = generateDateRange(startDate, endDate);
  const stats = {
    total: dates.length,
    unit: 'day',
    downloaded: 0,
    skipped: 0,
    empty: 0,
    errors: 0,
    files: 0,
  };

  console.log(`Strategy: daily`);
  console.log(`Total days: ${dates.length}`);
  console.log('');

  for (const date of dates) {
    const dateStr = formatDate(date);
    const isTodayDate = isToday(date);

    try {
      // Check existing files - skip logic depends on file type
      const singleFilePath = buildFilePath(slug, date);
      const hasSingleFile = fileExists(singleFilePath);
      const hasPagedFiles = fileExists(buildFilePath(slug, date, 1));

      if (!replace && !isTodayDate) {
        if (hasSingleFile) {
          // Non-paginated file exists - skip without HEAD request
          console.log(`  [SKIP] ${dateStr} - file exists`);
          stats.skipped++;
          continue;
        } else if (hasPagedFiles) {
          // Paginated files exist - check if last page is partial (< PAGE_LIMIT rows)
          const existingPages = countExistingPages(slug, date);
          const lastPageRows = countCsvRows(buildFilePath(slug, date, existingPages));

          if (lastPageRows < PAGE_LIMIT) {
            // Last page is partial → pagination is complete
            console.log(`  [SKIP] ${dateStr} - ${existingPages} file(s) complete`);
            stats.skipped++;
            continue;
          }

          // Last page is full → ambiguous, verify with HEAD request
          const totalCount = await fetchCount(slug, date, isHost, token);
          const expectedPages = Math.ceil(totalCount / PAGE_LIMIT);

          if (existingPages >= expectedPages) {
            console.log(`  [SKIP] ${dateStr} - ${existingPages} file(s) complete`);
            stats.skipped++;
            continue;
          } else {
            console.log(`  [INCOMPLETE] ${dateStr} - ${existingPages}/${expectedPages} files, re-downloading`);
          }
        }
      }

      if (dryRun) {
        const totalCount = await fetchCount(slug, date, isHost, token);
        const pageCount = Math.ceil(totalCount / PAGE_LIMIT) || 1;
        console.log(`  [DRY] ${dateStr} - would download ${totalCount} transaction(s) in ${pageCount} file(s)`);
        continue;
      }

      const result = await downloadDateTransactions(slug, date, options);

      if (result.empty) {
        console.log(`  [EMPTY] ${dateStr} - no transactions`);
        stats.empty++;
      } else if (result.error) {
        console.error(`  [ERROR] ${dateStr} - ${result.error}`);
        stats.errors++;
      } else {
        const fileLabel = result.pageCount > 1 ? `${result.pageCount} files` : buildFilePath(slug, date);
        console.log(`  [OK] ${dateStr} - ${result.totalCount} transaction(s) -> ${fileLabel}`);
        stats.downloaded++;
        stats.files += result.downloaded;
      }

      // Small delay between days to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      console.error(`  [ERROR] ${dateStr} - ${error.message}`);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Format a month range as "YYYY-MM" for display.
 */
function formatMonth(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Check if a month range includes today.
 */
function monthIncludesToday(month) {
  const today = getToday();
  return today >= month.start && today <= month.end;
}

/**
 * Download transactions for a date range using monthly strategy.
 */
async function downloadTransactionsMonthly(slug, startDate, endDate, options) {
  const { token, isHost, replace, dryRun, delayMs } = options;

  const months = generateMonthRange(startDate, endDate);
  const stats = {
    total: months.length,
    unit: 'month',
    downloaded: 0,
    skipped: 0,
    empty: 0,
    errors: 0,
    files: 0,
  };

  console.log(`Strategy: monthly`);
  console.log(`Total months: ${months.length}`);
  console.log('');

  for (const month of months) {
    const monthStr = `${formatMonth(month.start)} (${formatDate(month.start)} to ${formatDate(month.end)})`;
    const isCurrent = monthIncludesToday(month);

    try {
      const singleFilePath = buildMonthlyFilePath(slug, month.start);
      const hasSingleFile = fileExists(singleFilePath);
      const hasPagedFiles = fileExists(buildMonthlyFilePath(slug, month.start, 1));

      if (!replace && !isCurrent) {
        if (hasSingleFile) {
          console.log(`  [SKIP] ${monthStr} - file exists`);
          stats.skipped++;
          continue;
        } else if (hasPagedFiles) {
          const existingPages = countExistingMonthPages(slug, month.start);
          const lastPageRows = countCsvRows(buildMonthlyFilePath(slug, month.start, existingPages));

          if (lastPageRows < PAGE_LIMIT) {
            console.log(`  [SKIP] ${monthStr} - ${existingPages} file(s) complete`);
            stats.skipped++;
            continue;
          }

          const totalCount = await fetchMonthCount(slug, month, isHost, token);
          const expectedPages = Math.ceil(totalCount / PAGE_LIMIT);

          if (existingPages >= expectedPages) {
            console.log(`  [SKIP] ${monthStr} - ${existingPages} file(s) complete`);
            stats.skipped++;
            continue;
          } else {
            console.log(`  [INCOMPLETE] ${monthStr} - ${existingPages}/${expectedPages} files, re-downloading`);
          }
        }
      }

      if (dryRun) {
        const totalCount = await fetchMonthCount(slug, month, isHost, token);
        const pageCount = Math.ceil(totalCount / PAGE_LIMIT) || 1;
        console.log(`  [DRY] ${monthStr} - would download ${totalCount} transaction(s) in ${pageCount} file(s)`);
        continue;
      }

      const result = await downloadMonthTransactions(slug, month, options);

      if (result.empty) {
        console.log(`  [EMPTY] ${monthStr} - no transactions`);
        stats.empty++;
      } else if (result.error) {
        console.error(`  [ERROR] ${monthStr} - ${result.error}`);
        stats.errors++;
      } else {
        const fileLabel = result.pageCount > 1 ? `${result.pageCount} files` : buildMonthlyFilePath(slug, month.start);
        console.log(`  [OK] ${monthStr} - ${result.totalCount} transaction(s) -> ${fileLabel}`);
        stats.downloaded++;
        stats.files += result.downloaded;
      }

      // Small delay between months to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      console.error(`  [ERROR] ${monthStr} - ${error.message}`);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Format a year range as "YYYY" for display.
 */
function formatYear(date) {
  return String(date.getUTCFullYear());
}

/**
 * Check if a year range includes today.
 */
function yearIncludesToday(year) {
  const today = getToday();
  return today >= year.start && today <= year.end;
}

/**
 * Download transactions for a date range using yearly strategy.
 */
async function downloadTransactionsYearly(slug, startDate, endDate, options) {
  const { token, isHost, replace, dryRun, delayMs } = options;

  const years = generateYearRange(startDate, endDate);
  const stats = {
    total: years.length,
    unit: 'year',
    downloaded: 0,
    skipped: 0,
    empty: 0,
    errors: 0,
    files: 0,
  };

  console.log(`Strategy: yearly`);
  console.log(`Total years: ${years.length}`);
  console.log('');

  for (const year of years) {
    const yearStr = `${formatYear(year.start)} (${formatDate(year.start)} to ${formatDate(year.end)})`;
    const isCurrent = yearIncludesToday(year);

    try {
      const singleFilePath = buildYearlyFilePath(slug, year.start);
      const hasSingleFile = fileExists(singleFilePath);
      const hasPagedFiles = fileExists(buildYearlyFilePath(slug, year.start, 1));

      if (!replace && !isCurrent) {
        if (hasSingleFile) {
          console.log(`  [SKIP] ${yearStr} - file exists`);
          stats.skipped++;
          continue;
        } else if (hasPagedFiles) {
          const existingPages = countExistingYearPages(slug, year.start);
          const lastPageRows = countCsvRows(buildYearlyFilePath(slug, year.start, existingPages));

          if (lastPageRows < PAGE_LIMIT) {
            console.log(`  [SKIP] ${yearStr} - ${existingPages} file(s) complete`);
            stats.skipped++;
            continue;
          }

          const totalCount = await fetchYearCount(slug, year, isHost, token);
          const expectedPages = Math.ceil(totalCount / PAGE_LIMIT);

          if (existingPages >= expectedPages) {
            console.log(`  [SKIP] ${yearStr} - ${existingPages} file(s) complete`);
            stats.skipped++;
            continue;
          } else {
            console.log(`  [INCOMPLETE] ${yearStr} - ${existingPages}/${expectedPages} files, re-downloading`);
          }
        }
      }

      if (dryRun) {
        const totalCount = await fetchYearCount(slug, year, isHost, token);
        const pageCount = Math.ceil(totalCount / PAGE_LIMIT) || 1;
        console.log(`  [DRY] ${yearStr} - would download ${totalCount} transaction(s) in ${pageCount} file(s)`);
        continue;
      }

      const result = await downloadYearTransactions(slug, year, options);

      if (result.empty) {
        console.log(`  [EMPTY] ${yearStr} - no transactions`);
        stats.empty++;
      } else if (result.error) {
        console.error(`  [ERROR] ${yearStr} - ${result.error}`);
        stats.errors++;
      } else {
        const fileLabel = result.pageCount > 1 ? `${result.pageCount} files` : buildYearlyFilePath(slug, year.start);
        console.log(`  [OK] ${yearStr} - ${result.totalCount} transaction(s) -> ${fileLabel}`);
        stats.downloaded++;
        stats.files += result.downloaded;
      }

      // Small delay between years to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      console.error(`  [ERROR] ${yearStr} - ${error.message}`);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Download transactions for a date range.
 */
async function downloadTransactions(slug, startDate, endDate, options) {
  console.log(`Downloading transactions for ${slug}`);
  console.log(`Date range: ${formatDate(startDate)} to ${formatDate(endDate)}`);
  console.log(`Endpoint: ${options.isHost ? 'hostTransactions' : 'transactions'}`);

  if (options.strategy === 'yearly') {
    return downloadTransactionsYearly(slug, startDate, endDate, options);
  }
  if (options.strategy === 'monthly') {
    return downloadTransactionsMonthly(slug, startDate, endDate, options);
  }
  return downloadTransactionsDaily(slug, startDate, endDate, options);
}

// =============================================================================
// CLI
// =============================================================================

async function loadAccountConfig(dir) {
  const configPath = path.join(dir, 'oc.config.js');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const mod = await import(path.resolve(configPath));
    return mod.default;
  } catch (err) {
    console.error(`Error loading config from ${configPath}: ${err.message}`);
    process.exit(1);
  }
}

const getProgram = (argv) => {
  const program = new Command();
  program.exitOverride();
  program.showSuggestionAfterError();

  program.name('ofi-csv-download');
  program.description('Download Open Collective transaction CSVs');

  program.argument('<slug>', 'Account slug or directory with oc.config.js');

  program.option('--host', 'Use hostTransactions endpoint (for fiscal hosts)', false);
  program.option('--from <date>', 'Start date (YYYY-MM-DD). Default: January 1st of previous year');
  program.option('--to <date>', 'End date (YYYY-MM-DD). Default: yesterday');
  program.option('--days <n>', 'Number of days to download (overrides --from)', parseInt);
  program.option('--daily', 'Download by day instead of by month', false);
  program.option('--yearly', 'Download by year instead of by month', false);
  program.option('--strategy <strategy>', 'Download strategy: daily, monthly (default), yearly');
  program.option('--replace', 'Replace existing files', false);
  program.option('--dry-run', 'Show what would be downloaded without downloading', false);
  program.option('--rate-limit <n>', 'Max requests per minute (default: 60 with token, 10 without)', parseInt);

  program.addHelpText(
    'after',
    `
Authentication:
  Set PERSONAL_TOKEN in .env to access private account data.
  Public data works without a token.

Endpoints:
  transactions      For regular accounts (default)
  hostTransactions  For fiscal hosts (use --host flag)

File layout:
  monthly (default)  <slug>/YYYY/<slug>-YYYY-MM-transactions.csv
  daily              <slug>/YYYY/MM/<slug>-YYYY-MM-DD-transactions.csv
  yearly             <slug>/YYYY/<slug>-YYYY-transactions.csv

Examples:
  # Download last 30 days for a fiscal host
  ofi-csv-download ofitech --host

  # Download specific date range
  ofi-csv-download opencollective --from 2024-01-01 --to 2024-12-31

  # Download last 7 days
  ofi-csv-download myorg --days 7

  # Download by day instead of by month
  ofi-csv-download ofitech --host --daily --from 2024-01-01 --to 2024-12-31

  # Download by year instead of by month
  ofi-csv-download eslint --yearly

  # Using --strategy flag
  ofi-csv-download eslint --strategy yearly

  # Preview what would be downloaded
  ofi-csv-download ofitech --host --dry-run

  # Replace existing files
  ofi-csv-download ofitech --host --replace

  # Slow down to 5 requests per minute
  ofi-csv-download babel --rate-limit 5
`,
  );

  program.parse(argv);

  return program;
};

/**
 * Print download statistics.
 */
function printStats(stats) {
  const unit = stats.unit || 'day';
  console.log('\n=== Download Summary ===');
  console.log(`Total ${unit}s: ${stats.total}`);
  console.log(`Downloaded: ${stats.downloaded} ${unit}(s), ${stats.files} file(s)`);
  console.log(`Skipped (existing): ${stats.skipped}`);
  console.log(`Empty (no transactions): ${stats.empty}`);
  if (stats.errors > 0) {
    console.log(`Errors: ${stats.errors}`);
  }
}

async function main(argv = process.argv) {
  const program = getProgram(argv);
  const options = program.opts();
  let [slug] = program.args;

  // Check if slug is a directory with oc.config.js
  const isDir = fs.existsSync(slug) && fs.statSync(slug).isDirectory();
  const config = isDir ? await loadAccountConfig(slug) : null;
  const downloadConfig = config?.['ofi-csv-download'] || {};

  // Helper: use CLI value if explicitly set, otherwise config value, otherwise default
  const resolve = (optionName, configKey, fallback) => {
    if (program.getOptionValueSource(optionName) === 'cli') {
      return options[optionName];
    }
    return configKey in downloadConfig ? downloadConfig[configKey] : fallback;
  };

  const isHost = resolve('host', 'host', false);
  const isDaily = resolve('daily', 'daily', false);
  const isYearly = resolve('yearly', 'yearly', false);
  const resolvedStrategy = resolve('strategy', 'strategy', undefined);
  const strategy = resolvedStrategy || (isDaily ? 'daily' : isYearly ? 'yearly' : 'monthly');

  // When slug is a directory name, use config slug or directory basename as the slug
  if (isDir) {
    slug = config?.slug || path.basename(slug);
  }

  // Get token from environment (optional, allows access to private data)
  const token = process.env.PERSONAL_TOKEN;

  const defaultRateLimit = token ? 60 : 10;
  const rateLimit = Number(resolve('rateLimit', 'rate-limit', defaultRateLimit));
  const delayMs = Math.ceil(60000 / rateLimit);
  console.log(`Rate limit: ${rateLimit} req/min`);

  // Determine date range (default end date is today, since today auto-replaces)
  const endDate = options.to ? parseDate(options.to) : getToday();

  const fromDate = resolve('from', 'from', undefined);

  let startDate;
  if (fromDate) {
    startDate = parseDate(fromDate);
  } else if (options.days) {
    startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - options.days + 1);
  } else {
    // Default: January 1st of previous year
    startDate = new Date(Date.UTC(endDate.getUTCFullYear() - 1, 0, 1));
  }

  // Validate date range
  if (startDate > endDate) {
    console.error('Error: Start date must be before or equal to end date');
    process.exit(1);
  }

  // Download
  const stats = await downloadTransactions(slug, startDate, endDate, {
    token,
    isHost,
    replace: options.replace,
    dryRun: options.dryRun,
    strategy,
    delayMs,
  });

  // Print summary
  printStats(stats);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit())
    .catch((e) => {
      if (e.name !== 'CommanderError') {
        console.error(e);
      }
      process.exit(1);
    });
}

export {
  // Date utilities
  parseDate,
  formatDate,
  formatISODate,
  getYesterday,
  getToday,
  isToday,
  generateDateRange,
  generateMonthRange,
  generateYearRange,
  // File utilities
  buildFilePath,
  buildMonthlyFilePath,
  buildYearlyFilePath,
  ensureDirectory,
  fileExists,
  // REST utilities
  buildRestUrl,
  fetchCount,
  fetchMonthCount,
  fetchYearCount,
  fetchCsv,
  // Main
  downloadTransactions,
  downloadDateTransactions,
  downloadMonthTransactions,
  downloadYearTransactions,
  // Config
  CSV_FIELDS,
  DEFAULT_PARAMS,
  REST_BASE_URL,
  PAGE_LIMIT,
};
