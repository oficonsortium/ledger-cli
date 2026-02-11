#!/usr/bin/env node
/**
 * balance-download.js - Query account balances from Open Collective GraphQL API
 *
 * Generates a CSV file with opening balances for use with BALANCE_CARRYFORWARD rules.
 * Supports both fiscal hosts (all hosted accounts) and single accounts.
 *
 * USAGE
 * =====
 *
 *     # Using account directory (reads oc.config.js)
 *     ofi-balance-download webpack
 *     ofi-balance-download raft --date 2025-06-01
 *
 *     # Using explicit flags
 *     ofi-balance-download --host opensource --date 2025-01-01
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

import { Command } from 'commander';
import { parse as csvParseSync } from 'csv-parse/sync';

// =============================================================================
// Configuration
// =============================================================================

const API_URL = process.env.API_URL || 'https://api.opencollective.com';
const PAGE_LIMIT = 100;

/**
 * Build authentication headers from a token string.
 */
function buildAuthHeaders(token) {
  if (!token) {
    return {};
  }
  if (process.env.ACCESS_TOKEN) {
    return { Authorization: `Bearer ${token}` };
  }
  return { 'Personal-Token': token };
}

// CSV columns matching the BALANCE_CARRYFORWARD format
const CSV_COLUMNS = [
  'Date & Time',
  'Effective Date & Time',
  'Transaction ID',
  'Description',
  'Credit/Debit',
  'Kind',
  'Group ID',
  'Amount Single Column',
  'Currency',
  'Is Reverse',
  'Is Reversed',
  'Reverse Transaction ID',
  'Account Handle',
  'Account Name',
  'Opposite Account Handle',
  'Opposite Account Name',
  'Payment Processor',
  'Payment Method',
  'Contribution Memo',
  'Expense Type',
  'Expense Tags',
  'Expense Payout Method Type',
  'Accounting Category Code',
  'Accounting Category Name',
  'Merchant ID',
  'Reverse Kind',
  'Account Type',
  'Opposite Account Type',
  'Parent Account Handle',
  'Parent Account Type',
  'Opposite Parent Account Handle',
  'Opposite Parent Account Type',
];

// GraphQL query for host's own balance
const HOST_BALANCE_QUERY = /* GraphQL */ `
  query HostBalance($hostSlug: String!, $dateTo: DateTime!) {
    host(slug: $hostSlug) {
      id
      slug
      name
      type
      currency
      stats {
        balance(dateTo: $dateTo) {
          value
          valueInCents
          currency
        }
      }
    }
  }
`;

// GraphQL query for hosted account balances (paginated)
const HOSTED_ACCOUNTS_QUERY = /* GraphQL */ `
  query HostedAccountBalances(
    $hostSlug: String!
    $dateTo: DateTime!
    $limit: Int = 100
    $offset: Int = 0
    $accountType: [AccountType]
  ) {
    host(slug: $hostSlug) {
      hostedAccounts(limit: $limit, offset: $offset, accountType: $accountType, isApproved: true) {
        totalCount
        limit
        offset
        nodes {
          id
          legacyId
          slug
          name
          type
          currency
          ... on AccountWithParent {
            parent {
              slug
              type
            }
          }
          stats {
            balance(dateTo: $dateTo) {
              value
              valueInCents
              currency
            }
          }
        }
      }
    }
  }
`;

// GraphQL query for a single account's balance (including children)
const ACCOUNT_BALANCE_QUERY = /* GraphQL */ `
  query AccountBalance($slug: String!, $dateTo: DateTime!) {
    account(slug: $slug) {
      slug
      name
      type
      currency
      stats {
        balance(dateTo: $dateTo) {
          value
          valueInCents
          currency
        }
      }
      childrenAccounts(limit: 100) {
        nodes {
          slug
          name
          type
          currency
          stats {
            balance(dateTo: $dateTo) {
              value
              valueInCents
              currency
            }
          }
        }
      }
    }
  }
`;

// =============================================================================
// GraphQL Client
// =============================================================================

/**
 * Execute a GraphQL query with retry logic.
 */
async function graphqlRequest(query, variables, token, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${API_URL}/graphql/v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(token),
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Retry on 5xx errors
        if (response.status >= 500 && attempt < retries) {
          console.warn(`  Attempt ${attempt} failed (${response.status}), retrying in ${attempt * 2}s...`);
          await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
          continue;
        }
        throw new Error(`GraphQL request failed (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }

      return result.data;
    } catch (error) {
      if (attempt < retries && error.message.includes('fetch')) {
        console.warn(`  Attempt ${attempt} failed (${error.message}), retrying in ${attempt * 2}s...`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        continue;
      }
      throw error;
    }
  }
}

// =============================================================================
// Balance Fetching
// =============================================================================

/**
 * Fetch a single account's balance, including children (events, projects).
 */
async function fetchAccountBalance(slug, dateTo, token) {
  console.warn(`  Fetching balance for ${slug}...`);
  const data = await graphqlRequest(ACCOUNT_BALANCE_QUERY, { slug, dateTo }, token);

  if (!data.account) {
    throw new Error(`Account not found: ${slug}`);
  }

  const account = data.account;
  const balances = [];

  const balance = account.stats?.balance?.value || 0;
  const currency = account.stats?.balance?.currency || account.currency;
  console.warn(`  ${account.slug}: ${balance} ${currency}`);
  balances.push({
    slug: account.slug,
    name: account.name,
    type: account.type,
    currency,
    balance,
  });

  // Include children (events, projects) with non-zero balances
  for (const child of account.childrenAccounts?.nodes || []) {
    const childBalance = child.stats?.balance?.value || 0;
    if (childBalance !== 0) {
      const childCurrency = child.stats?.balance?.currency || child.currency;
      console.warn(`  ${child.slug} (${child.type}): ${childBalance} ${childCurrency}`);
      balances.push({
        slug: child.slug,
        name: child.name,
        type: child.type,
        currency: childCurrency,
        balance: childBalance,
        parentSlug: account.slug,
        parentType: account.type,
      });
    }
  }

  return balances;
}

/**
 * Fetch all hosted account balances with pagination.
 */
async function fetchAllBalances(hostSlug, dateTo, token, { delayMs = 500 } = {}) {
  const balances = [];

  // First, fetch the host's own balance (separate query, no pagination)
  console.warn('  Fetching host balance...');
  const hostData = await graphqlRequest(HOST_BALANCE_QUERY, { hostSlug, dateTo }, token);

  if (!hostData.host) {
    throw new Error(`Host not found: ${hostSlug}`);
  }

  const host = hostData.host;
  if (host.stats?.balance?.value) {
    balances.push({
      slug: host.slug,
      name: host.name,
      type: host.type,
      currency: host.stats.balance.currency,
      balance: host.stats.balance.value,
    });
    console.warn(`  Host ${host.slug}: ${host.stats.balance.value} ${host.stats.balance.currency}`);
  }

  // Now fetch hosted accounts with pagination
  let offset = 0;
  let totalCount = null;
  let totalPages = null;
  let currentPage = 0;

  while (totalCount === null || offset < totalCount) {
    currentPage++;
    const page = await graphqlRequest(
      HOSTED_ACCOUNTS_QUERY,
      {
        hostSlug,
        dateTo,
        limit: PAGE_LIMIT,
        offset,
        accountType: ['COLLECTIVE', 'FUND', 'EVENT', 'PROJECT'],
      },
      token,
    );

    const hostedAccounts = page.host.hostedAccounts;

    if (totalCount === null) {
      totalCount = hostedAccounts.totalCount;
      totalPages = Math.ceil(totalCount / PAGE_LIMIT);
    }

    for (const account of hostedAccounts.nodes) {
      if (account.stats?.balance?.value) {
        balances.push({
          slug: account.slug,
          name: account.name,
          type: account.type,
          currency: account.stats.balance.currency,
          balance: account.stats.balance.value,
          parentSlug: account.parent?.slug || '',
          parentType: account.parent?.type || '',
        });
      }
    }

    console.warn(`  Page ${currentPage}/${totalPages}: ${hostedAccounts.nodes.length} accounts`);
    offset += PAGE_LIMIT;

    // Delay to avoid rate limiting
    if (offset < totalCount) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return balances;
}

// =============================================================================
// CSV Generation
// =============================================================================

/**
 * Escape a CSV field value.
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV content from balances.
 * Produces BALANCE_CARRYFORWARD entries that establish opening balances.
 */
function generateCsv(balances, dateStr) {
  const lines = [CSV_COLUMNS.map(escapeCsvField).join(',')];

  let counter = 1;
  for (const account of balances) {
    // Skip zero balances
    if (account.balance === 0) {
      continue;
    }

    // Determine credit/debit based on balance sign
    const isPositive = account.balance > 0;
    const creditDebit = isPositive ? 'CREDIT' : 'DEBIT';
    const amount = Math.abs(account.balance);
    const id = String(counter++).padStart(6, '0');

    const row = {
      'Date & Time': dateStr,
      'Effective Date & Time': dateStr,
      'Transaction ID': `CARRYFORWARD-${id}`,
      Description: `Opening balance for ${account.name}`,
      'Credit/Debit': creditDebit,
      Kind: 'BALANCE_CARRYFORWARD',
      'Group ID': '',
      'Amount Single Column': amount.toFixed(2),
      Currency: account.currency,
      'Is Reverse': '',
      'Is Reversed': '',
      'Reverse Transaction ID': '',
      'Account Handle': account.slug,
      'Account Name': account.name,
      'Opposite Account Handle': '',
      'Opposite Account Name': '',
      'Payment Processor': '',
      'Payment Method': '',
      'Contribution Memo': '',
      'Expense Type': '',
      'Expense Tags': '',
      'Expense Payout Method Type': '',
      'Accounting Category Code': '',
      'Accounting Category Name': '',
      'Merchant ID': '',
      'Reverse Kind': '',
      'Account Type': account.type,
      'Opposite Account Type': '',
      'Parent Account Handle': account.parentSlug || '',
      'Parent Account Type': account.parentType || '',
      'Opposite Parent Account Handle': '',
      'Opposite Parent Account Type': '',
    };

    lines.push(CSV_COLUMNS.map((col) => escapeCsvField(row[col])).join(','));
  }

  return `${lines.join('\n')}\n`;
}

// =============================================================================
// CLI
// =============================================================================

/**
 * Build the default output file path.
 * Uses a fixed filename so re-running always overwrites the previous balance file.
 */
function buildDefaultOutputPath(slug) {
  return `${slug}/${slug}-opening-balances.csv`;
}

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

  program.name('ofi-balance-download');
  program.description('Query account balances from Open Collective GraphQL API');

  program.argument('[account-dir]', 'Account directory with oc.config.js');

  program.option('--host <slug>', 'Host slug (e.g., opensource, ofico)');
  program.option('--date <date>', 'Balance date (YYYY-MM-DD), defaults to config from date');
  program.option('-o, --output <file>', 'Output CSV file (default: <slug>/<slug>-opening-balances.csv)');
  program.option('--list', 'Output balances to stdout as slug, amount, currency (no CSV file)');
  program.option('--replace', 'Replace existing balance file', false);
  program.option('--rate-limit <n>', 'Max requests per minute (default: 60 with token, 10 without)', parseInt);

  program.addHelpText(
    'after',
    `
Authentication (optional):
  Set PERSONAL_TOKEN in .env to access private account data.
  Public data works without a token.

Output:
  Generates CSV with BALANCE_CARRYFORWARD entries for use with ofi-hledger-convert
  Use --list to output balances as a table to stdout (sorted by amount descending)

Examples:
  # Account directory (reads host and from date from oc.config.js)
  ofi-balance-download webpack
  ofi-balance-download raft --date 2025-06-01

  # Explicit host mode
  ofi-balance-download --host opensource --date 2025-01-01

  # List all balances to stdout
  ofi-balance-download --host ofico --date 2025-01-01 --list
`,
  );

  program.parse(argv);

  return program;
};

async function main(argv = process.argv) {
  const program = getProgram(argv);
  const options = program.opts();
  const [accountDirArg] = program.args;

  // Get token from environment (optional, allows access to private data)
  const token = process.env.ACCESS_TOKEN || process.env.PERSONAL_TOKEN;

  // Resolve config from account directory or CLI flags
  let slug;
  let isHost;
  let dateStr;

  if (accountDirArg) {
    const isDir = fs.existsSync(accountDirArg) && fs.statSync(accountDirArg).isDirectory();
    const config = isDir ? await loadAccountConfig(accountDirArg) : null;
    const downloadConfig = config?.['ofi-csv-download'] || {};

    slug = config?.slug || (isDir ? path.basename(accountDirArg) : accountDirArg);
    isHost = options.host ? true : (downloadConfig.host ?? false);

    // Date: CLI --date overrides config from
    const date = options.date || downloadConfig.from;
    if (!date) {
      console.error('Error: no date specified. Use --date or set from in oc.config.js');
      process.exit(1);
    }
    dateStr = `${date}T00:00:00.000Z`;

    // If --host flag was provided with a slug, use that slug for the host query
    if (options.host) {
      slug = options.host;
    }
  } else if (options.host) {
    // Legacy mode: --host flag without account directory
    slug = options.host;
    isHost = true;

    if (!options.date) {
      console.error('Error: --date is required when using --host without an account directory');
      process.exit(1);
    }
    dateStr = `${options.date}T00:00:00.000Z`;
  } else {
    program.help();
    return;
  }

  const defaultRateLimit = token ? 60 : 10;
  const rateLimit = options.rateLimit ? Number(options.rateLimit) : defaultRateLimit;
  const delayMs = Math.ceil(60000 / rateLimit);
  console.warn(`Rate limit: ${rateLimit} req/min`);

  const displayDate = dateStr.split('T')[0];

  // Determine output path early so we can check for existing file
  const outputDir = accountDirArg || slug;
  const outputPath = options.output || buildDefaultOutputPath(outputDir);

  // Skip if balance file already exists with matching date (unless --replace or --list)
  if (!options.replace && !options.list && fs.existsSync(outputPath)) {
    const existing = fs.readFileSync(outputPath, 'utf8');
    const rows = csvParseSync(existing, { columns: true, to: 1 });
    const existingDate = rows[0]?.['Date & Time'];
    if (existingDate === dateStr) {
      console.warn(`[SKIP] ${outputPath} already has balances for ${displayDate} (use --replace to overwrite)`);
      return;
    }
  }

  console.warn(`Fetching balances for ${slug} as of ${displayDate}...`);

  // Fetch balances
  const balances = isHost
    ? await fetchAllBalances(slug, dateStr, token, { delayMs })
    : await fetchAccountBalance(slug, dateStr, token);

  console.warn(`Found ${balances.length} account(s) with non-zero balances`);

  // If --list flag, output to stdout and exit
  if (options.list) {
    // Sort by amount descending (largest first)
    const sorted = [...balances].sort((a, b) => b.balance - a.balance);

    // Calculate column widths
    const slugWidth = Math.max(4, ...sorted.map((a) => a.slug.length));
    const amountWidth = Math.max(6, ...sorted.map((a) => a.balance.toFixed(2).length));

    // Print header
    console.log(`${'SLUG'.padEnd(slugWidth)}  ${'AMOUNT'.padStart(amountWidth)}  CURRENCY`);
    console.log(`${'-'.repeat(slugWidth)}  ${'-'.repeat(amountWidth)}  --------`);

    // Print rows
    for (const account of sorted) {
      console.log(
        `${account.slug.padEnd(slugWidth)}  ${account.balance.toFixed(2).padStart(amountWidth)}  ${account.currency}`,
      );
    }

    // Print total
    const total = sorted.reduce((sum, a) => sum + a.balance, 0);
    console.log(`${'-'.repeat(slugWidth)}  ${'-'.repeat(amountWidth)}  --------`);
    console.log(`${'TOTAL'.padEnd(slugWidth)}  ${total.toFixed(2).padStart(amountWidth)}`);
    return;
  }

  // Generate CSV
  const csv = generateCsv(balances, dateStr);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write output
  fs.writeFileSync(outputPath, csv);
  console.warn(`Wrote ${balances.length} opening balance entries to ${outputPath}`);
}

main()
  .then(() => process.exit())
  .catch((e) => {
    if (e.name !== 'CommanderError') {
      console.error(e);
    }
    process.exit(1);
  });

export { fetchAllBalances, fetchAccountBalance, generateCsv, graphqlRequest, API_URL, PAGE_LIMIT };
