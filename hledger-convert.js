#!/usr/bin/env node
/**
 * hledger-convert.js - Rule-based Open Collective CSV to hledger journal transformer
 *
 * Transaction handling is defined in JavaScript configuration files rather
 * than hardcoded logic, making it easier to customize for different accounts.
 *
 * USAGE
 * =====
 *
 *     ofi-hledger-convert input.csv > output.journal
 *     ofi-hledger-convert input.csv -o output.journal
 *     ofi-hledger-convert input.csv --rules ./ofico/rules-ofico.js
 *     ofi-hledger-convert input.csv --main-account myorg
 *
 * RULES
 * =====
 *
 * Rules are defined in JavaScript modules that export:
 * - settings: Default settings (currency, accounts)
 * - deduplication: Rules for skipping duplicate rows by mode
 * - rules: Array of rule objects with match conditions and entry templates
 *
 * See rules-base.js and ofico/rules-ofico.js for examples.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { Command } from 'commander';
import { parse as csvParseSync } from 'csv-parse/sync';
import { globSync } from 'glob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CSV column mappings for "Platform Default" format
const DATE_COLUMNS = {
  effective: 'Effective Date & Time',
  transaction: 'Date & Time',
};

const COLUMNS = {
  date: DATE_COLUMNS.transaction,
  transactionDate: DATE_COLUMNS.transaction,
  transactionId: 'Transaction ID',
  description: 'Description',
  creditDebit: 'Credit/Debit',
  kind: 'Kind',
  groupId: 'Group ID',
  amount: 'Amount Single Column',
  currency: 'Currency',
  isReverse: 'Is Reverse',
  isReversed: 'Is Reversed',
  reverseId: 'Reverse Transaction ID',
  reverseKind: 'Reverse Kind',
  accountHandle: 'Account Handle',
  accountName: 'Account Name',
  oppositeHandle: 'Opposite Account Handle',
  oppositeName: 'Opposite Account Name',
  paymentProcessor: 'Payment Processor',
  paymentMethod: 'Payment Method',
  expenseType: 'Expense Type',
  accountingCategoryCode: 'Accounting Category Code',
  accountingCategoryName: 'Accounting Category Name',
  expenseTags: 'Expense Tags',
  processorFee: 'Payment Processor Fee',
  hostFee: 'Host Fee',
  platformFee: 'Platform Fee',
  taxAmount: 'Tax Amount',
  accountType: 'Account Type',
  oppositeAccountType: 'Opposite Account Type',
  parentAccountHandle: 'Parent Account Handle',
  parentAccountType: 'Parent Account Type',
  oppositeParentAccountHandle: 'Opposite Parent Account Handle',
  oppositeParentAccountType: 'Opposite Parent Account Type',
};

// Default processor fee account
const DEFAULT_PROCESSOR_FEE_ACCOUNT = 'expenses:payment-processor-fees';

// =============================================================================
// File Input Handling
// =============================================================================

/**
 * Check if a string contains glob pattern characters.
 */
function isGlobPattern(input) {
  return /[*?[\]{}!]/.test(input);
}

/**
 * Resolve input to a list of files.
 * Supports single files, glob patterns, and directories.
 */
function resolveInputFiles(input) {
  // Check if it's a glob pattern
  if (isGlobPattern(input)) {
    const files = globSync(input, { nodir: true });
    if (files.length === 0) {
      throw new Error(`No files matched pattern: ${input}`);
    }
    // Sort files to ensure consistent ordering (chronological for date-based names)
    return files.sort();
  }

  // Check if it's a directory
  if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
    // Default to all CSV files in directory and subdirectories
    const pattern = path.join(input, '**', '*.csv');
    const files = globSync(pattern, { nodir: true });
    if (files.length === 0) {
      throw new Error(`No CSV files found in directory: ${input}`);
    }
    return files.sort();
  }

  // Single file
  if (!fs.existsSync(input)) {
    throw new Error(`File not found: ${input}`);
  }
  return [input];
}

/**
 * Read and parse multiple CSV files, skipping files with errors.
 * Returns { rows, skippedFiles } where rows is the combined parsed data.
 */
function readAndParseCsvFiles(files) {
  if (files.length === 0) {
    throw new Error('No files to process');
  }

  const allRows = [];
  const skippedFiles = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const rows = csvParseSync(content, { columns: true });
      allRows.push(...rows);
    } catch (error) {
      console.error(`\nWARNING: Skipping file with error: ${file}`);
      console.error(`  ${error.message}`);
      if (error.record) {
        console.error(`  Record: ${JSON.stringify(error.record)}`);
      }
      skippedFiles.push(file);
    }
  }

  if (allRows.length === 0 && skippedFiles.length > 0) {
    throw new Error(`All ${skippedFiles.length} files failed to parse`);
  }

  return { rows: allRows, skippedFiles };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Parse Open Collective date format to hledger format (YYYY-MM-DD).
 */
function parseDate(dateStr) {
  if (!dateStr) {
    return '';
  }
  return dateStr.substring(0, 10);
}

/**
 * Parse amount string to number.
 */
function parseAmount(amountStr) {
  if (!amountStr || amountStr.trim() === '') {
    return 0;
  }
  return parseFloat(String(amountStr).replace(',', ''));
}

/**
 * Format amount for hledger journal.
 */
function formatAmount(amount, currency) {
  const rounded = Math.round(amount * 100) / 100;
  return `${rounded.toFixed(2)} ${currency}`;
}

/**
 * Sanitize account name for hledger (remove problematic characters).
 */
function sanitizeAccountName(name) {
  if (!name) {
    return '';
  }
  let result = name.replace(/"/g, "'").replace(/\n/g, ' ').trim();
  result = result.replace(/\binc\b/gi, 'Inc');
  result = result.replace(/\bllc\b/gi, 'LLC');
  result = result.replace(/\bcorp\b/gi, 'Corp');
  result = result.replace(/\bltd\b/gi, 'Ltd');
  return result;
}

/**
 * Build semantic expense account name using accounting category.
 */
function buildExpenseAccount(
  accountingCode = '',
  accountingName = '',
  defaultAccount = 'expenses:uncategorized-expenses',
) {
  if (accountingCode && accountingName) {
    let normalizedName = accountingName.toLowerCase().replace(/ /g, '-').replace(/&/g, 'and');
    normalizedName = normalizedName.replace(/[^a-z0-9-]/g, '');
    while (normalizedName.includes('--')) {
      normalizedName = normalizedName.replace(/--/g, '-');
    }
    return `expenses:${accountingCode}-${normalizedName}`;
  }
  return defaultAccount;
}

/**
 * Parse common fields from a CSV row.
 */
function parseCommon(row) {
  return {
    date: parseDate(row[COLUMNS.date] || ''),
    description: row[COLUMNS.description] || '',
    transactionId: row[COLUMNS.transactionId] || '',
    groupId: row[COLUMNS.groupId] || '',
    amount: parseAmount(row[COLUMNS.amount] || '0'),
    currency: row[COLUMNS.currency] || 'USD',
    accountHandle: (row[COLUMNS.accountHandle] || '').trim(),
    oppositeHandle: (row[COLUMNS.oppositeHandle] || '').trim(),
    accountName: sanitizeAccountName(row[COLUMNS.accountName] || ''),
    oppositeName: sanitizeAccountName(row[COLUMNS.oppositeName] || ''),
    creditDebit: row[COLUMNS.creditDebit] || '',
    isReverse: row[COLUMNS.isReverse] || '',
    isReversed: row[COLUMNS.isReversed] || '',
    reverseId: row[COLUMNS.reverseId] || '',
    reverseKind: row[COLUMNS.reverseKind] || '',
    processorFee: parseAmount(row[COLUMNS.processorFee] || '0'),
    hostFee: parseAmount(row[COLUMNS.hostFee] || '0'),
    platformFee: parseAmount(row[COLUMNS.platformFee] || '0'),
    paymentProcessor: row[COLUMNS.paymentProcessor] || '',
    paymentMethod: row[COLUMNS.paymentMethod] || '',
    accountingCode: (row[COLUMNS.accountingCategoryCode] || '').trim(),
    accountingName: (row[COLUMNS.accountingCategoryName] || '').trim(),
    expenseTags: (row[COLUMNS.expenseTags] || '').trim(),
    expenseType: (row[COLUMNS.expenseType] || '').trim(),
    kind: row[COLUMNS.kind] || '',
    accountType: (row[COLUMNS.accountType] || '').trim().toLowerCase(),
    oppositeAccountType: (row[COLUMNS.oppositeAccountType] || '').trim().toLowerCase(),
    parentAccountHandle: (row[COLUMNS.parentAccountHandle] || '').trim(),
    parentAccountType: (row[COLUMNS.parentAccountType] || '').trim().toLowerCase(),
    oppositeParentAccountHandle: (row[COLUMNS.oppositeParentAccountHandle] || '').trim(),
    oppositeParentAccountType: (row[COLUMNS.oppositeParentAccountType] || '').trim().toLowerCase(),
  };
}

// =============================================================================
// Rule Matching Engine
// =============================================================================

/**
 * Check if a value matches a condition.
 *
 * Supported condition formats:
 * - Exact match: 'VALUE'
 * - List match (OR): ['VALUE1', 'VALUE2']
 * - Contains: { contains: 'substring' } or { contains: ['sub1', 'sub2'] }
 * - Case-insensitive contains: { icontains: 'substring' }
 * - Not contains: { notContains: 'substring' }
 * - Negation: { not: 'VALUE' }
 */
function matchCondition(fieldValue, condition) {
  if (condition === undefined || condition === null) {
    return true; // No condition = always match
  }

  // Exact match (string)
  if (typeof condition === 'string') {
    return fieldValue === condition;
  }

  // List match (OR) - array of strings
  if (Array.isArray(condition)) {
    return condition.includes(fieldValue);
  }

  // Object conditions
  if (typeof condition === 'object') {
    // Negation: { not: 'VALUE' }
    if ('not' in condition) {
      return fieldValue !== condition.not;
    }

    // Contains: { contains: 'substring' } or { contains: ['sub1', 'sub2'] }
    if ('contains' in condition) {
      const patterns = Array.isArray(condition.contains) ? condition.contains : [condition.contains];
      return patterns.some((pattern) => fieldValue.includes(pattern));
    }

    // Case-insensitive contains: { icontains: 'substring' }
    if ('icontains' in condition) {
      const lowerValue = fieldValue.toLowerCase();
      const patterns = Array.isArray(condition.icontains) ? condition.icontains : [condition.icontains];
      return patterns.some((pattern) => lowerValue.includes(pattern.toLowerCase()));
    }

    // Not contains: { notContains: 'substring' }
    if ('notContains' in condition) {
      const patterns = Array.isArray(condition.notContains) ? condition.notContains : [condition.notContains];
      return !patterns.some((pattern) => fieldValue.includes(pattern));
    }

    // Case-insensitive not contains: { notIcontains: 'substring' }
    if ('notIcontains' in condition) {
      const lowerValue = fieldValue.toLowerCase();
      const patterns = Array.isArray(condition.notIcontains) ? condition.notIcontains : [condition.notIcontains];
      return !patterns.some((pattern) => lowerValue.includes(pattern.toLowerCase()));
    }
  }

  return false;
}

/**
 * Check if a row matches all conditions in a rule's match block.
 * All conditions are AND-ed together.
 *
 * Special handling for transactionId: also matches if the row's reverseId
 * matches the specified transactionId(s), enabling auto-reverse for one-off rules.
 */
function matchRule(row, match) {
  const c = parseCommon(row);

  // Map match field names to parsed values
  const fieldMap = {
    kind: c.kind,
    creditDebit: c.creditDebit,
    isReverse: c.isReverse,
    isReversed: c.isReversed,
    expenseType: c.expenseType,
    expenseTags: c.expenseTags,
    description: c.description,
    oppositeHandle: c.oppositeHandle,
    accountHandle: c.accountHandle,
    paymentMethod: c.paymentMethod,
    paymentProcessor: c.paymentProcessor,
    transactionId: c.transactionId,
    reverseId: c.reverseId,
  };

  // Check each condition in the match block
  for (const [field, condition] of Object.entries(match)) {
    const fieldValue = fieldMap[field];
    if (fieldValue === undefined) {
      console.warn(`Warning: Unknown match field '${field}'`);
      return false;
    }

    // Special handling for transactionId: also match if reverseId matches
    // This enables auto-reverse for one-off rules targeting specific transactions
    if (field === 'transactionId') {
      const matchesTransactionId = matchCondition(fieldValue, condition);
      const matchesReverseId = matchCondition(fieldMap.reverseId, condition);
      if (!matchesTransactionId && !matchesReverseId) {
        return false;
      }
    } else if (!matchCondition(fieldValue, condition)) {
      return false;
    }
  }

  return true;
}

/**
 * Find the first matching rule for a row.
 * Returns { rule, autoReverse } where autoReverse is true if using a normal rule for a REVERSE row.
 *
 * For REVERSE rows, tries three strategies:
 * 1. Exact match (explicit reversal rules)
 * 2. Match ignoring isReverse condition (same creditDebit)
 * 3. Match ignoring isReverse AND with flipped creditDebit (CREDIT↔DEBIT)
 */
function findMatchingRule(row, rules) {
  const isReverse = row[COLUMNS.isReverse] === 'REVERSE';
  const creditDebit = row[COLUMNS.creditDebit] || '';

  // First pass: try to find an exact match (including explicit reversal rules)
  for (const rule of rules) {
    if (matchRule(row, rule.match)) {
      return { rule, autoReverse: false };
    }
  }

  // For REVERSE rows, try auto-reverse matching
  if (isReverse) {
    const flippedCreditDebit = creditDebit === 'CREDIT' ? 'DEBIT' : 'CREDIT';

    // Second pass: try matching with FLIPPED creditDebit (most common for Open Collective)
    // When creditDebit flips, the CSV amounts are already correct - no negation needed
    // E.g., CREDIT+REVERSE row matches DEBIT rule (refund of expense you paid)
    // E.g., DEBIT+REVERSE row matches CREDIT rule (refund of invoice you received)
    for (const rule of rules) {
      if (rule.match.isReverse === 'REVERSE') {
        continue;
      }

      const matchFlipped = { ...rule.match };
      delete matchFlipped.isReverse;

      // Check if rule expects the flipped creditDebit
      if (matchFlipped.creditDebit === flippedCreditDebit) {
        // Remove creditDebit from match and test other conditions against original row
        delete matchFlipped.creditDebit;
        if (Object.keys(matchFlipped).length === 0 || matchRuleWithConditions(row, matchFlipped)) {
          return { rule, autoReverse: 'flipped' };
        }
      }
    }

    // Third pass: try matching with SAME creditDebit (less common)
    // For same creditDebit reversals, we need to negate amounts
    for (const rule of rules) {
      if (rule.match.isReverse === 'REVERSE') {
        continue;
      }

      const matchWithoutReverse = { ...rule.match };
      delete matchWithoutReverse.isReverse;

      if (matchRuleWithConditions(row, matchWithoutReverse)) {
        return { rule, autoReverse: 'same' };
      }
    }
  }

  return { rule: null, autoReverse: false };
}

/**
 * Match a row against specific conditions (helper for auto-reverse matching).
 */
function matchRuleWithConditions(row, match) {
  const c = parseCommon(row);

  const fieldMap = {
    kind: c.kind,
    creditDebit: c.creditDebit,
    isReverse: c.isReverse,
    isReversed: c.isReversed,
    expenseType: c.expenseType,
    expenseTags: c.expenseTags,
    description: c.description,
    oppositeHandle: c.oppositeHandle,
    accountHandle: c.accountHandle,
    paymentMethod: c.paymentMethod,
    paymentProcessor: c.paymentProcessor,
  };

  for (const [field, condition] of Object.entries(match)) {
    const fieldValue = fieldMap[field];
    if (fieldValue === undefined) {
      return false;
    }
    if (!matchCondition(fieldValue, condition)) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// Variable Substitution
// =============================================================================

/**
 * Build a context object with all available variables for template substitution.
 */
function buildContext(row, settings) {
  const c = parseCommon(row);

  // Build expense account
  const expenseAccount = buildExpenseAccount(
    c.accountingCode,
    c.accountingName,
    settings.defaultExpenseAccount || 'expenses:disbursed',
  );

  // Main account setting - nests sub-accounts under main by accountType
  const mainAccount = settings.mainAccount;

  // Map accountType to plural prefix for hierarchy
  const typeToPrefix = {
    collective: 'collectives',
    fund: 'funds',
    event: 'events',
    project: 'projects',
  };

  // Helper to calculate scope and asset path for an account handle
  // accountType can be 'organization', 'collective', 'fund', 'event', 'project', etc.
  // parentHandle/parentType are optional - if provided, nests under parent
  const calculateScope = (handle, accountType, parentHandle = '', parentType = '') => {
    if (mainAccount) {
      // Main account (organization) uses its handle directly
      const isMain = handle === mainAccount || accountType === 'organization';
      if (isMain) {
        return {
          scope: mainAccount,
          asset: `assets:opencollective:${mainAccount}`,
        };
      }

      // Get type prefix for current account
      const typePrefix = typeToPrefix[accountType];

      // If parent exists and is not the main account, nest under parent
      if (parentHandle && parentHandle !== mainAccount && parentType !== 'organization') {
        const parentTypePrefix = typeToPrefix[parentType];
        if (parentTypePrefix && typePrefix) {
          // Full nesting: <main>:<parentType>s:<parent>:<type>s:<handle>
          return {
            scope: `${mainAccount}:${parentTypePrefix}:${parentHandle}:${typePrefix}:${handle}`,
            asset: `assets:opencollective:${mainAccount}:${parentTypePrefix}:${parentHandle}:${typePrefix}:${handle}`,
          };
        }
        if (parentTypePrefix) {
          // Parent has type but child doesn't
          return {
            scope: `${mainAccount}:${parentTypePrefix}:${parentHandle}:${handle}`,
            asset: `assets:opencollective:${mainAccount}:${parentTypePrefix}:${parentHandle}:${handle}`,
          };
        }
      }

      // Nest by account type if available (no parent or parent is main)
      if (typePrefix) {
        return {
          scope: `${mainAccount}:${typePrefix}:${handle}`,
          asset: `assets:opencollective:${mainAccount}:${typePrefix}:${handle}`,
        };
      }
      // Fallback: nest directly under main
      return {
        scope: `${mainAccount}:${handle}`,
        asset: `assets:opencollective:${mainAccount}:${handle}`,
      };
    }
    // No main account - flat structure
    return {
      scope: handle,
      asset: `assets:opencollective:${handle}`,
    };
  };

  // Determine scope for current account (with optional parent nesting)
  const { scope, asset: scopedAsset } = calculateScope(
    c.accountHandle,
    c.accountType,
    c.parentAccountHandle,
    c.parentAccountType,
  );

  // Determine scope for opposite account (with optional parent nesting)
  const { scope: oppositeScope, asset: oppositeScopedAsset } = calculateScope(
    c.oppositeHandle,
    c.oppositeAccountType,
    c.oppositeParentAccountHandle,
    c.oppositeParentAccountType,
  );

  // Build scoped expense account (always scoped by account)
  const scopedExpense = expenseAccount.replace('expenses:', `expenses:${scope}:`);

  // Build expenseTypeLower for use in templates
  const expenseTypeLower = ((type) => {
    const lower = (type || 'other').toLowerCase().replace(/_/g, '-');
    return lower === 'receipt' ? 'reimbursement' : lower;
  })(c.expenseType);

  // Build kindKebab for default rules (e.g., ADDED_FUNDS → added-funds)
  const kindKebab = (c.kind || 'unknown').toLowerCase().replace(/_/g, '-');

  // Build scoped processor fee account (always scoped by account)
  const processorFeeAccount = settings.processorFeeAccount || DEFAULT_PROCESSOR_FEE_ACCOUNT;
  const scopedProcessorFee = processorFeeAccount.replace('expenses:', `expenses:${scope}:`);

  // Detect internal transfer (same parent hierarchy)
  // Internal = both accounts share the same parent, or one IS the parent of the other
  const isInternal =
    // Both have same parent (e.g., two projects under same collective)
    (c.parentAccountHandle && c.parentAccountHandle === c.oppositeParentAccountHandle) ||
    // Current account IS the opposite's parent (e.g., collective → its project)
    (c.accountHandle && c.accountHandle === c.oppositeParentAccountHandle) ||
    // Opposite IS the current account's parent (e.g., project → its collective)
    (c.oppositeHandle && c.oppositeHandle === c.parentAccountHandle);

  return {
    // Amounts
    amount: c.amount,
    absAmount: Math.abs(c.amount),
    '-amount': -c.amount,
    '-absAmount': -Math.abs(c.amount),

    // IDs
    transactionId: c.transactionId,
    groupId: c.groupId,

    // Account info
    accountHandle: c.accountHandle,
    accountName: c.accountName,
    oppositeHandle: c.oppositeHandle,
    oppositeName: c.oppositeName,

    // Transaction details
    description: c.description,
    date: c.date,
    currency: c.currency,
    kind: c.kind,
    creditDebit: c.creditDebit,
    isReverse: c.isReverse,
    reverseId: c.reverseId,
    expenseTags: c.expenseTags,
    paymentProcessor: c.paymentProcessor || 'other',
    paymentMethod: c.paymentMethod,
    expenseType: c.expenseType,
    expenseTypeLower,
    kindKebab,

    // Fees (for column-based format)
    processorFee: c.processorFee,
    hostFee: c.hostFee,
    platformFee: c.platformFee,

    // Computed accounts
    expense: expenseAccount,
    processorFeeAccount,
    scopedProcessorFee,

    // Scoping
    scope,
    scopedAsset,
    oppositeScope,
    oppositeScopedAsset,
    scopedExpense,
    isMainAccount: mainAccount && (c.accountHandle === mainAccount || c.accountType === 'organization'),
    mainAccount,
    isInternal,

    // Settings
    ...settings,
  };
}

/**
 * Substitute variables in a template string.
 * Variables use ${variable} syntax.
 */
function substituteTemplate(template, context) {
  if (typeof template !== 'string') {
    return template;
  }

  return template.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    // Handle negated amounts
    if (varName === '-amount') {
      return -context.amount;
    }
    if (varName === '-absAmount') {
      return -context.absAmount;
    }

    if (varName in context) {
      return context[varName];
    }

    console.warn(`Warning: Unknown variable '${varName}' in template`);
    return match;
  });
}

/**
 * Substitute variables in an amount value.
 * Amount can be a number, string, or template.
 */
function substituteAmount(amountSpec, context) {
  if (typeof amountSpec === 'number') {
    return amountSpec;
  }

  if (typeof amountSpec === 'string') {
    // Handle template variables
    if (amountSpec.startsWith('${')) {
      const varName = amountSpec.slice(2, -1);
      if (varName === '-amount') {
        return -context.amount;
      }
      if (varName === '-absAmount') {
        return -context.absAmount;
      }
      if (varName === 'amount') {
        return context.amount;
      }
      if (varName === 'absAmount') {
        return context.absAmount;
      }
    }
    return parseFloat(amountSpec) || 0;
  }

  return 0;
}

// =============================================================================
// Entry Generation
// =============================================================================

/**
 * Generate journal entries from a rule and row.
 * @param {Object} rule - The matched rule
 * @param {Object} row - The CSV row
 * @param {Object} settings - Settings from rules config
 * @param {string|boolean} autoReverse - Auto-reverse mode:
 *   - false: no auto-reverse
 *   - 'flipped': creditDebit is flipped from rule, DON'T negate amounts (OC standard)
 *   - 'same': same creditDebit as rule, DO negate amounts
 */
function generateEntries(rule, row, settings, autoReverse = false) {
  const context = buildContext(row, settings);
  const entries = [];

  // Only negate amounts for same-creditDebit auto-reverse
  // For flipped creditDebit, the CSV amounts are already correct
  const shouldNegateAmounts = autoReverse === 'same';
  const isAutoReversed = autoReverse === 'flipped' || autoReverse === 'same';

  for (const entryTemplate of rule.entries) {
    // Build transaction ID
    let transactionId = context.transactionId;
    if (entryTemplate.suffix) {
      // For auto-reverse, modify the suffix to indicate reversal
      const suffix = isAutoReversed
        ? entryTemplate.suffix.replace('-recognition', '-reverse-recognition').replace('-payout', '-reverse-payout')
        : entryTemplate.suffix;
      transactionId = `${context.transactionId}${suffix}`;
    } else if (isAutoReversed) {
      transactionId = `${context.transactionId}-reversed`;
    }

    // Build description
    let description = entryTemplate.description
      ? substituteTemplate(entryTemplate.description, context)
      : context.description;

    // For auto-reverse, add "(reversed)" suffix if not already present
    if (isAutoReversed && !description.includes('reversed')) {
      description = `${description} (reversed)`;
    }

    // Build postings - only negate amounts for same-creditDebit auto-reverse
    const postings = entryTemplate.postings.map((p) => {
      let amount = substituteAmount(p.amount, context);
      if (shouldNegateAmounts) {
        amount = -amount;
      }
      return {
        account: substituteTemplate(p.account, context),
        amount,
        currency: context.currency,
      };
    });

    // For internal transfers (DEBIT side only), replace expense with opposite asset
    // This prevents internal movements from inflating expense totals
    // The CREDIT side is skipped via deduplication (see shouldSkip)
    // Only applies to transfer-type transactions (BALANCE_TRANSFER, ADDED_FUNDS)
    const transferKinds = ['BALANCE_TRANSFER', 'ADDED_FUNDS'];
    if (context.isInternal && context.creditDebit === 'DEBIT' && transferKinds.includes(context.kind)) {
      for (const posting of postings) {
        if (posting.account.startsWith('expenses:')) {
          posting.account = context.oppositeScopedAsset;
        }
      }
    }

    // Build tags
    const tags = { id: transactionId, group: context.groupId };
    if (context.isReverse || isAutoReversed) {
      tags.reversing = context.reverseId;
    }
    if (isAutoReversed) {
      tags.autoReversed = autoReverse;
    }
    if (context.expenseTags) {
      tags.tags = context.expenseTags;
    }
    if (context.accountName) {
      tags.account = context.accountName;
    }
    if (context.oppositeHandle) {
      tags.payee = context.oppositeHandle;
    }
    if (context.oppositeName) {
      tags.payeeName = context.oppositeName;
    }
    if (context.paymentProcessor && context.paymentProcessor !== 'other') {
      tags.paymentProcessor = context.paymentProcessor;
    }
    if (context.paymentMethod) {
      tags.paymentMethod = context.paymentMethod;
    }

    // Merge entry-specific tags
    if (entryTemplate.tags) {
      for (const [key, value] of Object.entries(entryTemplate.tags)) {
        const resolvedValue = substituteTemplate(value, context);
        if (resolvedValue) {
          tags[key] = resolvedValue;
        }
      }
    }

    entries.push({
      date: context.date,
      description,
      transactionId,
      groupId: context.groupId,
      postings,
      tags,
    });
  }

  return entries;
}

// =============================================================================
// Deduplication
// =============================================================================

/**
 * Check if a row should be skipped based on deduplication rules.
 * Rules can match on: kind, creditDebit, oppositeHandle, oppositeAccountType
 *
 * Also skips CREDIT side of internal transfers (same parent hierarchy) to avoid
 * double-counting. The DEBIT side is kept and converted to asset-to-asset.
 * Only applies to transfer-type transactions (BALANCE_TRANSFER, ADDED_FUNDS).
 */
function shouldSkip(row, deduplicationRules) {
  // Skip CREDIT side of internal transfers (DEBIT side handles the full movement)
  // Only for transfer-type transactions - expenses and contributions are handled differently
  const kind = row[COLUMNS.kind] || '';
  const transferKinds = ['BALANCE_TRANSFER', 'ADDED_FUNDS'];

  if (transferKinds.includes(kind)) {
    const creditDebit = row[COLUMNS.creditDebit] || '';
    if (creditDebit === 'CREDIT') {
      const accountHandle = (row[COLUMNS.accountHandle] || '').trim();
      const oppositeHandle = (row[COLUMNS.oppositeHandle] || '').trim();
      const parentAccountHandle = (row[COLUMNS.parentAccountHandle] || '').trim();
      const oppositeParentAccountHandle = (row[COLUMNS.oppositeParentAccountHandle] || '').trim();

      const isInternal =
        (parentAccountHandle && parentAccountHandle === oppositeParentAccountHandle) ||
        (accountHandle && accountHandle === oppositeParentAccountHandle) ||
        (oppositeHandle && oppositeHandle === parentAccountHandle);

      if (isInternal) {
        return true;
      }
    }
  }

  if (!deduplicationRules || !Array.isArray(deduplicationRules) || deduplicationRules.length === 0) {
    return false;
  }

  for (const rule of deduplicationRules) {
    let matches = true;

    // Check kind
    if (rule.kind) {
      const kinds = Array.isArray(rule.kind) ? rule.kind : [rule.kind];
      if (!kinds.includes(row[COLUMNS.kind])) {
        matches = false;
      }
    }

    // Check creditDebit
    if (matches && rule.creditDebit) {
      if (row[COLUMNS.creditDebit] !== rule.creditDebit) {
        matches = false;
      }
    }

    // Check oppositeHandle
    if (matches && rule.oppositeHandle) {
      if (row[COLUMNS.oppositeHandle] !== rule.oppositeHandle) {
        matches = false;
      }
    }

    // Check oppositeAccountType
    if (matches && rule.oppositeAccountType) {
      const types = Array.isArray(rule.oppositeAccountType) ? rule.oppositeAccountType : [rule.oppositeAccountType];
      if (!types.includes(row[COLUMNS.oppositeAccountType])) {
        matches = false;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// CSV Processing
// =============================================================================

/**
 * Detect CSV format based on content.
 */
function detectFormat(rows, feeFormat) {
  if (feeFormat !== 'auto') {
    return feeFormat;
  }

  const feeColumn = COLUMNS.processorFee;
  for (const row of rows) {
    const feeValue = row[feeColumn] || '';
    if (feeValue && feeValue.trim()) {
      try {
        const fee = parseFloat(feeValue.replace(',', ''));
        if (fee !== 0) {
          return 'columns';
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  return 'rows';
}

/**
 * Merge fee postings into main transaction postings.
 */
function mergePostings(mainPostings, feePostings) {
  const consolidated = new Map();

  for (const posting of [...mainPostings, ...feePostings]) {
    const key = `${posting.account}|${posting.currency}`;
    if (consolidated.has(key)) {
      const existing = consolidated.get(key);
      consolidated.set(key, {
        account: posting.account,
        amount: existing.amount + posting.amount,
        currency: posting.currency,
      });
    } else {
      consolidated.set(key, { ...posting });
    }
  }

  const result = [];
  for (const posting of consolidated.values()) {
    // Skip zero-amount postings (e.g., platform tips that cancel out)
    const rounded = Math.round(posting.amount * 100) / 100;
    if (rounded === 0) {
      continue;
    }
    if (posting.account.startsWith('assets:')) {
      result.unshift(posting);
    } else {
      result.push(posting);
    }
  }

  return result;
}

/**
 * Process CSV rows with rule-based transformation.
 * Returns { entries, stats } where stats tracks rule match counts.
 */
function processCsv(rows, rulesConfig, feeFormat, mainAccount = null) {
  const detectedFormat = detectFormat(rows, feeFormat);
  console.warn(`CSV format: ${detectedFormat}`);

  const settings = {
    ...(rulesConfig.settings || {}),
    mainAccount,
  };
  const rules = rulesConfig.rules || [];
  const deduplicationRules = rulesConfig.deduplication || [];

  // Track rule match statistics
  const ruleStats = new Map();
  for (const rule of rules) {
    ruleStats.set(rule.name, 0);
  }
  let unmatchedCount = 0;
  let skippedCount = 0;
  let feeRowsCount = 0;

  // Group rows by groupId for fee merging
  const groups = new Map();
  for (const row of rows) {
    const groupId = row[COLUMNS.groupId] || '';
    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }
    groups.get(groupId).push(row);
  }

  const entries = [];
  const processedTransactions = new Set();
  // Processor fee kinds - only merged in 'rows' format (in 'columns' format they're embedded in Amount)
  const processorFeeKinds = ['PAYMENT_PROCESSOR_FEE', 'PAYMENT_PROCESSOR_COVER', 'PAYMENT_PROCESSOR_DISPUTE_FEE'];

  // Helper to check if a row should merge (based on rule's merge property or processor fee kinds)
  const shouldRowMerge = (row, matchedRule) => {
    const kind = row[COLUMNS.kind] || '';
    // Processor fees merge in 'rows' format
    if (detectedFormat === 'rows' && processorFeeKinds.includes(kind)) {
      return true;
    }
    // Rule-based merge
    return matchedRule?.merge === true;
  };

  // Pre-compute which rows should merge (need to find rules first)
  const rowMergeInfo = new Map();
  for (const row of rows) {
    const { rule } = findMatchingRule(row, rules);
    rowMergeInfo.set(row[COLUMNS.transactionId], { rule, shouldMerge: shouldRowMerge(row, rule) });
  }

  for (const row of rows) {
    const transactionId = row[COLUMNS.transactionId] || '';
    const groupId = row[COLUMNS.groupId] || '';
    const kind = row[COLUMNS.kind] || '';

    // Skip already processed
    if (processedTransactions.has(transactionId)) {
      continue;
    }

    // Skip mergeable rows - they'll be merged into parent transactions
    const mergeInfo = rowMergeInfo.get(transactionId);
    if (mergeInfo?.shouldMerge) {
      feeRowsCount++;
      continue;
    }

    // Skip based on deduplication rules
    if (shouldSkip(row, deduplicationRules)) {
      skippedCount++;
      continue;
    }

    // Find matching rule
    const { rule, autoReverse } = findMatchingRule(row, rules);
    if (!rule) {
      console.warn(`Warning: No matching rule for transaction ${transactionId} (kind: ${kind})`);
      unmatchedCount++;
      continue;
    }

    // Track rule match (note if auto-reversed)
    const statKey = autoReverse ? `${rule.name} (auto-reversed:${autoReverse})` : rule.name;
    ruleStats.set(statKey, (ruleStats.get(statKey) || 0) + 1);

    // Generate entries
    const generatedEntries = generateEntries(rule, row, settings, autoReverse);

    // Collect mergeable postings (fees, host fees) from group rows
    const mergedPostings = [];
    // Don't merge into rows that themselves should merge
    const canMergeInto = !mergeInfo?.shouldMerge;
    if (canMergeInto) {
      for (const groupRow of groups.get(groupId) || []) {
        const rowTid = groupRow[COLUMNS.transactionId] || '';
        const groupRowMergeInfo = rowMergeInfo.get(rowTid);
        // Only merge rows marked for merging
        if (groupRowMergeInfo?.shouldMerge) {
          if (processedTransactions.has(rowTid) || shouldSkip(groupRow, deduplicationRules)) {
            continue;
          }
          const { rule: mergeRule } = groupRowMergeInfo;
          const { autoReverse: mergeAutoReverse } = findMatchingRule(groupRow, rules);
          if (mergeRule) {
            const mergeStatKey = mergeAutoReverse
              ? `${mergeRule.name} (auto-reversed:${mergeAutoReverse})`
              : mergeRule.name;
            ruleStats.set(mergeStatKey, (ruleStats.get(mergeStatKey) || 0) + 1);
            const mergeEntries = generateEntries(mergeRule, groupRow, settings, mergeAutoReverse);
            for (const mergeEntry of mergeEntries) {
              mergedPostings.push(...mergeEntry.postings);
            }
            processedTransactions.add(rowTid);
          }
        }
      }
    }

    // Merge collected postings (fees, host fees) into entries
    if (mergedPostings.length > 0 && generatedEntries.length > 0) {
      // Merge into the last entry (payout) for multi-entry transactions
      const lastIdx = generatedEntries.length - 1;
      generatedEntries[lastIdx] = {
        ...generatedEntries[lastIdx],
        postings: mergePostings(generatedEntries[lastIdx].postings, mergedPostings),
      };
    }

    // In 'columns' format, add fee postings to gross up revenue and record expenses.
    // Amount is NET (after fees), so we DON'T touch the asset - just adjust revenue and add expense.
    // Example: $5 donation, $0.74 processor fee → Amount=4.26, Fee=-0.74
    //   Asset: +4.26 (from rule, already net)
    //   Revenue: -4.26 + (-0.74) = -5.00 (grossed up)
    //   Expense: +0.74 (fee recorded)
    if (detectedFormat === 'columns' && generatedEntries.length > 0) {
      const ctx = buildContext(row, settings);
      const lastIdx = generatedEntries.length - 1;
      const lastEntry = generatedEntries[lastIdx];
      // Find revenue posting to gross it up (account starting with 'revenues:')
      const revenuePosting = lastEntry.postings.find((p) => p.account.startsWith('revenues:'));

      if (revenuePosting) {
        const feePostings = [];

        // Processor fee
        if (ctx.processorFee && ctx.processorFee !== 0) {
          feePostings.push(
            { account: revenuePosting.account, amount: ctx.processorFee, currency: ctx.currency },
            { account: ctx.scopedProcessorFee, amount: -ctx.processorFee, currency: ctx.currency },
          );
        }

        // Host fee (collective pays to host)
        if (ctx.hostFee && ctx.hostFee !== 0) {
          feePostings.push(
            { account: revenuePosting.account, amount: ctx.hostFee, currency: ctx.currency },
            { account: `expenses:${ctx.scope}:host-fees`, amount: -ctx.hostFee, currency: ctx.currency },
          );
        }

        // Platform fee (host pays to Open Collective)
        if (ctx.platformFee && ctx.platformFee !== 0) {
          feePostings.push(
            { account: revenuePosting.account, amount: ctx.platformFee, currency: ctx.currency },
            { account: `expenses:${ctx.scope}:platform-fees`, amount: -ctx.platformFee, currency: ctx.currency },
          );
        }

        if (feePostings.length > 0) {
          generatedEntries[lastIdx] = {
            ...lastEntry,
            postings: mergePostings(lastEntry.postings, feePostings),
          };
        }
      }
    }

    entries.push(...generatedEntries);
    processedTransactions.add(transactionId);
  }

  // Sort entries chronologically (oldest first)
  entries.sort((a, b) => a.date.localeCompare(b.date));

  const stats = {
    totalRows: rows.length,
    processedTransactions: processedTransactions.size,
    entriesGenerated: entries.length,
    skippedDedup: skippedCount,
    feeRowsMerged: feeRowsCount,
    unmatched: unmatchedCount,
    ruleMatches: ruleStats,
  };

  return { entries, stats };
}

// =============================================================================
// Journal Formatting
// =============================================================================

/**
 * Format journal entries as hledger journal text.
 */
function formatJournal(entries) {
  const lines = [];

  for (const entry of entries) {
    lines.push(`${entry.date} ${entry.description}`);

    // Output each tag on its own line for readability
    for (const [key, value] of Object.entries(entry.tags)) {
      lines.push(`    ; ${key}:${value}`);
    }

    // Calculate alignment: 4 spaces after longest account, min 12-char amount (matches hledger print)
    const maxAccountLen = Math.max(...entry.postings.map((p) => p.account.length));
    const amounts = entry.postings.map((p) => formatAmount(p.amount, p.currency));
    const maxAmountLen = Math.max(12, ...amounts.map((a) => a.length));
    // Total line width: 4 (indent) + maxAccount + 4 (spacing) + maxAmount
    const lineWidth = 4 + maxAccountLen + 4 + maxAmountLen;

    for (let i = 0; i < entry.postings.length; i++) {
      const posting = entry.postings[i];
      const amountStr = amounts[i];
      const accountPart = `    ${posting.account}`;
      const padding = lineWidth - accountPart.length - amountStr.length;
      lines.push(`${accountPart}${' '.repeat(padding)}${amountStr}`);
    }

    lines.push('');
  }

  // Add trailing newline to match hledger print output
  lines.push('');

  return lines.join('\n');
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

async function loadRules(rulesPath) {
  const absolutePath = path.resolve(rulesPath);
  try {
    const module = await import(absolutePath);
    return module.default;
  } catch (err) {
    console.error(`Error loading rules from ${absolutePath}: ${err.message}`);
    process.exit(1);
  }
}

const getProgram = (argv) => {
  const program = new Command();
  program.exitOverride();
  program.showSuggestionAfterError();

  program.name('ofi-hledger-convert');
  program.description('Rule-based Open Collective CSV to hledger journal transformer');

  program.argument('<input...>', 'Input CSV file(s), glob pattern(s), or directory/directories');

  program.option('-o, --output <file>', 'Output journal file (default: stdout)');
  program.option('-r, --rules <file>', 'Rules configuration file (default: ./rules-base.js)', './rules-base.js');
  program.option(
    '--main-account <handle>',
    'Main account handle (nests sub-accounts by accountType: collectives, funds, events, projects)',
  );
  program.option('--fee-format <format>', 'Fee format: auto (default), rows, columns', 'auto');
  program.option('--from <date>', 'Skip rows before this date (YYYY-MM-DD)');
  program.option('--to <date>', 'Skip rows after this date (YYYY-MM-DD, inclusive)');
  program.option('--date-field <field>', 'Date field: transaction (default) or effective', 'transaction');
  program.option('--stats', 'Print rule match statistics after conversion');

  program.addHelpText(
    'after',
    `
Account Hierarchy (with --main-account):
  organization  <main>
  collective    <main>:collectives:<handle>
  fund          <main>:funds:<handle>
  event         <main>:events:<handle>
  project       <main>:projects:<handle>

Fee Formats:
  auto          Auto-detect based on CSV content (default)
  rows          Fees as separate PAYMENT_PROCESSOR_FEE rows (recommended)
  columns       Fees embedded in "Payment Processor Fee" column (deprecated)

Input:
  Accepts CSV files, glob patterns, directories, or account directories.
  When given a directory with oc.config.js, loads config as defaults.
  When given a plain directory, processes all *.csv files recursively.
  Multiple inputs can be specified for batch processing.

Rules:
  Rules are defined in JavaScript modules. See rules-base.js for the base rules
  and ofico/rules-ofico.js for an example of organization-specific customization.

Examples:
  # Account directory (uses oc.config.js)
  ofi-hledger-convert ofitech
  ofi-hledger-convert ofico ofitech opensource

  # Single file
  ofi-hledger-convert export.csv > journal.hledger

  # Glob patterns
  ofi-hledger-convert "ofitech/2024/**/*.csv" -o journal.hledger

  # CLI flags override config
  ofi-hledger-convert ofitech --main-account custom-name
`,
  );

  program.parse(argv);

  return program;
};

/**
 * Print rule match statistics report.
 */
function printStats(stats) {
  console.warn('\n=== Rule Match Report ===');
  console.warn(`Total CSV rows: ${stats.totalRows}`);
  console.warn(`Transactions processed: ${stats.processedTransactions}`);
  console.warn(`Journal entries generated: ${stats.entriesGenerated}`);
  if (stats.skippedDedup > 0) {
    console.warn(`Rows skipped (deduplication): ${stats.skippedDedup}`);
  }
  console.warn(`Rows merged (fees, host fees, platform fees): ${stats.feeRowsMerged}`);
  if (stats.unmatched > 0) {
    console.warn(`Unmatched rows: ${stats.unmatched}`);
  }
  console.warn('\nRule matches:');

  // Sort rules by match count (descending), then by name
  const sortedRules = [...stats.ruleMatches.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  for (const [ruleName, count] of sortedRules) {
    if (count > 0) {
      console.warn(`  ${ruleName}: ${count}`);
    }
  }

  // Show rules with zero matches
  const unusedRules = sortedRules.filter(([, count]) => count === 0);
  if (unusedRules.length > 0) {
    console.warn('\nUnused rules (0 matches):');
    for (const [ruleName] of unusedRules) {
      console.warn(`  ${ruleName}`);
    }
  }
}

async function processInput(input, program) {
  const cliOptions = program.opts();

  // Check if input is a directory with oc.config.js
  const isDir = fs.existsSync(input) && fs.statSync(input).isDirectory();
  const config = isDir ? await loadAccountConfig(input) : null;
  const hledgerConfig = config?.['ofi-hledger-convert'] || {};

  // Helper: use CLI value if explicitly set, otherwise config value, otherwise default
  const resolve = (optionName, configKey, fallback) => {
    if (program.getOptionValueSource(optionName) === 'cli') {
      return cliOptions[optionName];
    }
    return configKey in hledgerConfig ? hledgerConfig[configKey] : fallback;
  };

  // Resolve options
  const defaultRulesPath = path.join(__dirname, 'rules-base.js');
  const rulesPath = resolve('rules', 'rules', defaultRulesPath);
  const rulesFromConfig = config && 'rules' in hledgerConfig && program.getOptionValueSource('rules') !== 'cli';
  const mainAccountOpt = resolve('mainAccount', 'main-account', undefined);
  const feeFormat = resolve('feeFormat', 'fee-format', 'auto');
  const dateField = resolve('dateField', 'date-field', 'transaction');
  const outputPath = resolve('output', 'output', isDir ? 'transactions.journal' : undefined);

  // Resolve --from: CLI > ofi-hledger-convert.from > ofi-csv-download.from
  const fromDate =
    program.getOptionValueSource('from') === 'cli'
      ? cliOptions.from
      : hledgerConfig.from || config?.['ofi-csv-download']?.from || undefined;

  // Resolve --to: CLI > ofi-hledger-convert.to > ofi-csv-download.to
  const toDate =
    program.getOptionValueSource('to') === 'cli'
      ? cliOptions.to
      : hledgerConfig.to || config?.['ofi-csv-download']?.to || undefined;

  // Set the date column based on --date-field option
  if (dateField === 'effective') {
    COLUMNS.date = DATE_COLUMNS.effective;
  } else {
    COLUMNS.date = DATE_COLUMNS.transaction;
  }

  // Resolve paths relative to account directory when the value came from config or defaulted
  const resolvedRulesPath = rulesFromConfig ? path.join(input, rulesPath) : rulesPath;
  const resolvedOutput = isDir && outputPath ? path.join(input, outputPath) : outputPath;

  // Resolve input files
  let resolvedInput;
  if (config && hledgerConfig.input) {
    // Config-specified input, resolved relative to the account directory
    resolvedInput = path.join(input, hledgerConfig.input);
  } else {
    resolvedInput = input;
  }

  // Load rules
  const rulesConfig = await loadRules(resolvedRulesPath);

  // Determine main account handle (CLI > config main-account > config slug > rules settings > directory name)
  const mainAccount =
    mainAccountOpt || config?.slug || rulesConfig.settings?.mainAccount || (isDir ? path.basename(input) : null);

  // Resolve input to file list and read/parse CSV files
  const files = resolveInputFiles(resolvedInput);
  if (files.length > 1) {
    console.warn(`Processing ${files.length} CSV files...`);
  }

  const parsed = readAndParseCsvFiles(files);
  let rows = parsed.rows;
  const { skippedFiles } = parsed;
  if (skippedFiles.length > 0) {
    console.warn(`\nSkipped ${skippedFiles.length} file(s) with errors, continuing with ${rows.length} rows...`);
  }

  // Filter rows before the from date using the transaction date (Date & Time),
  // not the effective date. This matches the API's balance calculation semantics:
  // the API balance at a date reflects transactions processed up to that date.
  if (fromDate) {
    const totalBefore = rows.length;
    rows = rows.filter((row) => {
      const txnDate = (row[DATE_COLUMNS.transaction] || '').substring(0, 10);
      return txnDate >= fromDate;
    });
    const filtered = totalBefore - rows.length;
    if (filtered > 0) {
      console.warn(`Filtered ${filtered} rows before ${fromDate} (${rows.length} remaining)`);
    }
  }

  // Filter rows after the to date (inclusive upper bound)
  if (toDate) {
    const totalBefore = rows.length;
    rows = rows.filter((row) => {
      const txnDate = (row[DATE_COLUMNS.transaction] || '').substring(0, 10);
      return txnDate <= toDate;
    });
    const filtered = totalBefore - rows.length;
    if (filtered > 0) {
      console.warn(`Filtered ${filtered} rows after ${toDate} (${rows.length} remaining)`);
    }
  }

  const { entries, stats } = processCsv(rows, rulesConfig, feeFormat, mainAccount);

  // Format output
  const journal = formatJournal(entries);

  // Write output
  if (resolvedOutput) {
    fs.writeFileSync(resolvedOutput, journal);
    console.warn(`Wrote ${entries.length} entries to ${resolvedOutput}`);
  } else {
    console.log(journal);
  }

  // Print statistics report if requested
  if (cliOptions.stats) {
    printStats(stats);
  }
}

async function main(argv = process.argv) {
  const program = getProgram(argv);
  const inputs = program.args;

  for (const input of inputs) {
    if (inputs.length > 1) {
      console.warn(`\n${'='.repeat(60)}`);
      console.warn(`Processing: ${input}`);
      console.warn('='.repeat(60));
    }
    await processInput(input, program);
  }
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
  // File input
  isGlobPattern,
  resolveInputFiles,
  readAndParseCsvFiles,
  // Utilities
  parseDate,
  parseAmount,
  formatAmount,
  sanitizeAccountName,
  buildExpenseAccount,
  parseCommon,
  // Rule engine
  matchCondition,
  matchRule,
  findMatchingRule,
  buildContext,
  substituteTemplate,
  substituteAmount,
  generateEntries,
  // Deduplication
  shouldSkip,
  // Processing
  detectFormat,
  mergePostings,
  processCsv,
  formatJournal,
  loadRules,
  // Constants
  COLUMNS,
  DEFAULT_PROCESSOR_FEE_ACCOUNT,
};
