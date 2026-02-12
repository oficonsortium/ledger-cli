#!/usr/bin/env node
/**
 * hledger.js - Query hledger journals using ofi-ledger.config.js
 *
 * Reads the journal output path from an account's ofi-ledger.config.js
 * and passes all remaining arguments to hledger.
 * Falls back to transactions.journal if no config exists.
 *
 * USAGE
 * =====
 *
 *     ./hledger.js ofitech bs
 *     ./hledger.js ofico is --depth 2
 *     ./hledger.js raft is --alias '/^(revenues|expenses):(operating|collectives:[^:]+):(.*)$/=\1:\3'
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();
program.name('ofi-hledger');
program.description('Query hledger journals using ofi-ledger.config.js');

program.argument('<account-dir>', 'Account directory with ofi-ledger.config.js');
program.argument('[hledger-args...]', 'hledger command and arguments (e.g. bs, is --depth 2)');

program.option('-i, --init', 'Initialize account directory with ofi-ledger.config.js');
program.option('-d, --download', 'Download latest transactions before querying');
program.option('--from <date>', 'Download start date (YYYY-MM-DD), forwarded to ofi-csv-download');
program.option('--to <date>', 'Download end date (YYYY-MM-DD), forwarded to ofi-csv-download');
program.option('--balances', 'Fetch opening balances before querying');
program.option('-c, --convert', 'Re-generate journal from CSVs before querying');
program.option('-a, --auto', 'Shortcut for --init --download --balances --convert');
program.option('--replace', 'Replace existing files, forwarded to download commands', false);
program.option('--page-limit <n>', 'Max transactions per file/request, forwarded to ofi-csv-download', parseInt);
program.option('--rate-limit <n>', 'Max requests per minute, forwarded to download commands', parseInt);

program.enablePositionalOptions();
program.passThroughOptions();

program.addHelpText(
  'after',
  `
All arguments after <account-dir> are passed through to hledger.
Place ofi-hledger options BEFORE <account-dir>.

Examples:
  ofi-hledger ofitech bs
  ofi-hledger ofico is --depth 2
  ofi-hledger --download --convert ofitech bs
  ofi-hledger --auto babel bs
  ofi-hledger --auto --from 2025-01-01 raft is
`,
);

program.parse();

const opts = program.opts();
const [accountDir, ...hledgerArgs] = program.args;

// --auto expands to --init --download --balances --convert
if (opts.auto) {
  opts.init = true;
  opts.download = true;
  opts.balances = true;
  opts.convert = true;
}

if (opts.init) {
  const initScript = path.join(__dirname, 'ledger-cli-init.js');
  console.error(`> ofi-ledger-cli-init ${accountDir}`);
  execFileSync('node', [initScript, accountDir], { stdio: 'inherit' });
}

// Load config if it exists, otherwise use defaults
const configPath = path.resolve(accountDir, 'ofi-ledger.config.js');
let config = {};
if (fs.existsSync(configPath)) {
  config = (await import(configPath)).default;
}

if (opts.download && !opts.from) {
  const configFrom = config?.['ofi-csv-download']?.from;
  if (configFrom) {
    console.error(`Downloading from ${configFrom} (config default). Use --from to override.`);
  }
}

if (opts.download) {
  const downloadScript = path.join(__dirname, 'csv-download.js');
  const downloadArgs = [downloadScript, accountDir];
  if (opts.from) {
    downloadArgs.push('--from', opts.from);
  }
  if (opts.to) {
    downloadArgs.push('--to', opts.to);
  }
  if (opts.replace) {
    downloadArgs.push('--replace');
  }
  if (opts.pageLimit) {
    downloadArgs.push('--page-limit', String(opts.pageLimit));
  }
  if (opts.rateLimit) {
    downloadArgs.push('--rate-limit', String(opts.rateLimit));
  }
  console.error(`> ofi-csv-download ${downloadArgs.slice(1).join(' ')}`);
  execFileSync('node', downloadArgs, { stdio: 'inherit' });
}

if (opts.balances) {
  const balancesScript = path.join(__dirname, 'balance-download.js');
  const balancesArgs = [balancesScript, accountDir];
  if (opts.from) {
    balancesArgs.push('--date', opts.from);
  }
  if (opts.replace) {
    balancesArgs.push('--replace');
  }
  if (opts.rateLimit) {
    balancesArgs.push('--rate-limit', String(opts.rateLimit));
  }
  console.error(`> ofi-balance-download ${balancesArgs.slice(1).join(' ')}`);
  execFileSync('node', balancesArgs, { stdio: 'inherit' });
}

if (opts.convert) {
  const convertScript = path.join(__dirname, 'hledger-convert.js');
  const convertArgs = [convertScript, accountDir];
  if (opts.from) {
    convertArgs.push('--from', opts.from);
  }
  if (opts.to) {
    convertArgs.push('--to', opts.to);
  }
  console.error(`> ofi-hledger-convert ${convertArgs.slice(1).join(' ')}`);
  execFileSync('node', convertArgs, { stdio: 'inherit' });
}

if (hledgerArgs.length > 0) {
  const output = config['ofi-hledger-convert']?.output || 'transactions.journal';
  const journalPath = path.join(accountDir, output);
  const defaultArgs = config['ofi-hledger']?.args || [];
  const fullArgs = ['-f', journalPath, ...defaultArgs, ...hledgerArgs];

  console.error(`> hledger ${fullArgs.map((a) => (a.includes(' ') ? `'${a}'` : a)).join(' ')}`);

  try {
    execFileSync('hledger', fullArgs, { stdio: 'inherit' });
  } catch (e) {
    // hledger already printed its error, just propagate exit code
    process.exit(e.status || 1);
  }
} else if (!opts.init && !opts.download && !opts.balances && !opts.convert) {
  program.help();
}
