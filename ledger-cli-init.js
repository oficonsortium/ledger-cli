#!/usr/bin/env node
/**
 * ledger-cli-init.js - Initialize an account directory with oc.config.js
 *
 * Queries the Open Collective GraphQL API to determine the account type,
 * transaction volume, and generates an appropriate oc.config.js.
 * If oc.config.js already exists, fills in missing values without
 * overwriting existing ones.
 *
 * USAGE
 * =====
 *
 *     ofi-ledger-cli-init ofitech
 *     ofi-ledger-cli-init phpfoundation
 *
 * AUTHENTICATION (optional)
 * =========================
 *
 * Set PERSONAL_TOKEN in a .env file or as an environment variable
 * to access private account data. Public data works without a token.
 * Generate a token at https://opencollective.com/applications
 */

import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { Command } from 'commander';

const GRAPHQL_URL = 'https://api.opencollective.com/graphql/v2';

/**
 * Build a GraphQL query that fetches account info and transaction counts.
 * Uses the oldest transaction date to compute dynamic date ranges.
 */
function buildQuery(now) {
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastYearStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
  const lastYearEnd = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  return {
    query: /* GraphQL */ `
      query AccountInit(
        $slug: String!
        $lastMonthStart: DateTime!
        $lastMonthEnd: DateTime!
        $lastYearStart: DateTime!
        $lastYearEnd: DateTime!
      ) {
        account(slug: $slug) {
          slug
          name
          type
          currency
          ... on AccountWithHost {
            isActive
            host {
              slug
              name
            }
          }
          ... on Organization {
            hasMoneyManagement
            hasHosting
          }
          oldest: transactions(limit: 1, orderBy: { field: CREATED_AT, direction: ASC }) {
            nodes {
              createdAt
            }
          }
          lastMonth: transactions(limit: 0, dateFrom: $lastMonthStart, dateTo: $lastMonthEnd) {
            totalCount
          }
          lastYear: transactions(limit: 0, dateFrom: $lastYearStart, dateTo: $lastYearEnd) {
            totalCount
          }
        }
      }
    `,
    variables: {
      lastMonthStart: lastMonthStart.toISOString(),
      lastMonthEnd: lastMonthEnd.toISOString(),
      lastYearStart: lastYearStart.toISOString(),
      lastYearEnd: lastYearEnd.toISOString(),
    },
  };
}

async function graphqlRequest(query, variables, token) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Personal-Token': token }),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GraphQL request failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

/**
 * Pick a download strategy based on transaction volume.
 * Target: ~1000 transactions per file (soft limit).
 *
 * - yearly:  <= 1000/year
 * - monthly: <= 1000/month (i.e. <= ~12000/year)
 * - daily:   > 1000/month
 */
function pickStrategy(lastMonthCount, lastYearCount) {
  if (lastMonthCount > 1000) {
    return 'daily';
  }
  if (lastYearCount <= 1000) {
    return 'yearly';
  }
  return 'monthly';
}

/**
 * Build the defaults config object from API data.
 */
function buildDefaults({ slug, hasHosting, strategy, oldestDate }) {
  const downloadConfig = { host: hasHosting };
  if (strategy !== 'monthly') {
    downloadConfig.strategy = strategy;
  }
  if (oldestDate) {
    downloadConfig.from = `${oldestDate.slice(0, 7)}-01`;
  }

  const convertConfig = {};
  const suffix = hasHosting ? 'host-transactions' : 'transactions';
  convertConfig.output = `${slug}-${suffix}.journal`;

  return {
    slug,
    'oc-csv-download': downloadConfig,
    'oc-hledger-convert': convertConfig,
  };
}

/**
 * Deep merge defaults into existing config. Existing values are never overwritten.
 * Only missing keys at each level are filled in.
 */
function mergeDefaults(existing, defaults) {
  const result = { ...existing };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in result)) {
      result[key] = value;
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof result[key] === 'object'
    ) {
      result[key] = mergeDefaults(result[key], value);
    }
    // else: existing value wins, skip
  }
  return result;
}

/**
 * Serialize a config object to JS source (export default { ... }).
 */
function serializeConfig(config) {
  return `export default ${JSON.stringify(config, null, 2)};\n`;
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

async function main(argv = process.argv) {
  const program = new Command();
  program.exitOverride();
  program.name('ofi-ledger-cli-init');
  program.description('Initialize an account directory with oc.config.js from Open Collective API');
  program.argument('<slug>', 'Account slug (e.g. ofitech, phpfoundation)');
  program.option('--dry-run', 'Print config without writing');
  program.parse(argv);

  const [slug] = program.args;
  const opts = program.opts();
  const token = process.env.PERSONAL_TOKEN;
  const now = new Date();

  // Build and execute query
  const { query, variables } = buildQuery(now);
  const data = await graphqlRequest(query, { slug, ...variables }, token);

  if (!data.account) {
    console.error(`Account not found: ${slug}`);
    process.exit(1);
  }

  const account = data.account;
  const hasMoneyManagement = account.hasMoneyManagement || false;
  const hasHosting = account.hasHosting || false;
  const oldestDate = account.oldest?.nodes?.[0]?.createdAt?.split('T')[0] || null;
  const lastMonthCount = account.lastMonth?.totalCount || 0;
  const lastYearCount = account.lastYear?.totalCount || 0;

  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthLabel = lastMonth.toISOString().slice(0, 7);
  const lastYearLabel = `${now.getUTCFullYear() - 1}`;

  // Print account summary
  console.error(`Account:            ${account.name} (${account.slug})`);
  console.error(`Type:               ${account.type}`);
  console.error(`Currency:           ${account.currency}`);
  if (hasMoneyManagement) {
    console.error(`Money management:   ${hasMoneyManagement}`);
  }
  if (hasHosting) {
    console.error(`Hosting:            ${hasHosting}`);
  }
  if (!hasHosting && account.host) {
    console.error(`Host:               ${account.host.slug} (${account.host.name})`);
  }
  if (oldestDate) {
    console.error(`Oldest transaction: ${oldestDate}`);
  }
  console.error(`Transactions (${lastMonthLabel}): ${lastMonthCount.toLocaleString()}`);
  console.error(`Transactions (${lastYearLabel}):    ${lastYearCount.toLocaleString()}`);

  // Pick strategy
  const strategy = pickStrategy(lastMonthCount, lastYearCount);
  console.error(`Strategy:           ${strategy}`);

  // Build defaults from API data
  const defaults = buildDefaults({ slug, hasHosting, strategy, oldestDate });

  // Load existing config and merge
  const dir = path.resolve(slug);
  const existing = fs.existsSync(dir) ? await loadAccountConfig(dir) : null;
  const merged = existing ? mergeDefaults(existing, defaults) : defaults;

  const configContent = serializeConfig(merged);

  if (opts.dryRun) {
    console.error(`\n--- ${slug}/oc.config.js (dry run) ---`);
    console.log(configContent);
    return;
  }

  // Create directory if needed
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.error(`\nCreated ${slug}/`);
  }

  const configPath = path.join(dir, 'oc.config.js');
  fs.writeFileSync(configPath, configContent);

  if (existing) {
    console.error(`\nUpdated ${slug}/oc.config.js (filled missing defaults)`);
  } else {
    console.error(`\nWrote ${slug}/oc.config.js`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    if (e.name !== 'CommanderError') {
      console.error(e.message);
      process.exit(1);
    }
  });
}
