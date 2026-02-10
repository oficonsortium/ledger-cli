# ofi-hledger

Query hledger journals using account config. Reads the journal path from `oc.config.js` and passes arguments to hledger.

## Usage

```bash
ofi-hledger <account-dir> [hledger-args...] [options]
```

```bash
# Balance sheet
ofi-hledger ofitech bs

# Income statement
ofi-hledger ofico is

# With depth
ofi-hledger raft is --depth 1

# Monthly
ofi-hledger ofitech is -M

# Filter by collective
ofi-hledger ofitech is acct:collectives:my-collective

# Search by tag
ofi-hledger ofitech reg tag:payee=stripe
```

## Options

### `--init` / `-i`

Initialize the account directory by running `ofi-ledger-cli-init`. Creates `oc.config.js` from the Open Collective GraphQL API. Fills missing config values without overwriting existing ones.

```bash
ofi-hledger webpack --init
ofi-hledger webpack -i -d -c bs
```

### `--download` / `-d`

Download latest transactions from Open Collective before querying. Runs `ofi-csv-download <account-dir>` first.

```bash
ofi-hledger ofitech bs --download
ofi-hledger ofitech bs -d
```

### `--from <date>` / `--to <date>`

Date range forwarded to `ofi-csv-download` (with `--download`), `ofi-balance-download` (with `--balances`, `--from` is used as `--date`), and `ofi-hledger-convert` (with `--convert`, `--from` filters rows before the date).

```bash
ofi-hledger webpack -d --from 2025-01-01
ofi-hledger webpack -d --from 2025-01-01 --to 2025-12-31
```

### `--balances`

Fetch account balances from the Open Collective GraphQL API before querying. Runs `ofi-balance-download <account-dir>`. Uses `--from` as the balance date if provided.

```bash
ofi-hledger webpack --balances --from 2025-01-01
```

### `--convert` / `-c`

Re-generate the journal from CSVs before querying. Runs `ofi-hledger-convert <account-dir>` first, then proceeds with the hledger query.

```bash
ofi-hledger ofitech bs --convert
ofi-hledger ofitech is -c
```

### `--auto` / `-a`

Shortcut for `--init --download --balances --convert`. Runs the full pipeline: init, download, balances, convert, then query.

```bash
ofi-hledger webpack -a bs
ofi-hledger webpack --auto --from 2025-01-01 bs
```

Without `--from`, downloads from the oldest transaction date (set by init in config), which can be slow for accounts with long histories. Use `--from` to scope the download:

```bash
# Quarterly report — only download what you need
ofi-hledger webpack --auto --from 2025-01-01 is -Q
```

### Combining flags

Flags can be combined. They run in order: init, download, balances, convert, query.

```bash
# Download, convert, then query
ofi-hledger ofitech bs -d -c

# Full pipeline (equivalent to --auto)
ofi-hledger webpack -i -d --balances --from 2025-01-01 -c bs

# Download only (no hledger query)
ofi-hledger webpack -d --from 2025-01-01
```

If no hledger args are provided and no flags are set, the help text is shown.

## Config

`ofi-hledger` reads from two sections in `oc.config.js`:

- `ofi-hledger-convert.output` - journal file path (required)
- `hledger.args` - default arguments prepended to every query (optional)

```js
export default {
  'ofi-hledger-convert': {
    output: 'ofitech-host-transactions.journal',
    // ...
  },
  hledger: {
    args: ['--alias', '/^(revenues|expenses):(operating|collectives:[^:]+):(.*)$/=\\1:\\3'],
  },
};
```

With the config above, `ofi-hledger ofitech is` runs:

```
> hledger -f ofitech/ofitech-host-transactions.journal --alias '/^(revenues|expenses):(operating|collectives:[^:]+):(.*)$/=\1:\3' is
```

CLI args are appended after config args.

## Useful hledger Commands

```bash
bs                    # Balance sheet
is                    # Income statement
is -M                 # Monthly income statement
reg                   # Transaction register
reg desc:payroll      # Search by description
bal -b 2025-01 -e 2025-12  # Date range
```

## Flattening Scoped Accounts

Remove the scope prefix to see consolidated categories:

```bash
# Fiscal-host mode
ofi-hledger ofitech is --alias '/^(revenues|expenses):(operating|collectives:[^:]+):(.*)$/=\1:\3'

# Organization mode
ofi-hledger ofico is --alias '/^(revenues|expenses):[^:]+:(.*)$/=\1:\2'
```

Or add the alias to `hledger.args` in `oc.config.js` to apply it by default.
