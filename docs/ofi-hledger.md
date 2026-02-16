# ofi-hledger

All-in-one CLI: init, download, balances, convert, then query hledger. Runs the full pipeline by default. Use `--no-*` flags to skip steps.

## Usage

```bash
ofi-hledger <account-dir> [hledger-args...]
```

```bash
# Balance sheet (runs full pipeline first)
ofi-hledger babel bs

# With date range
ofi-hledger babel --from 2025-01-01 bs

# Income statement with depth
ofi-hledger babel is --depth 2

# Monthly income statement
ofi-hledger babel is -M

# Sync only (no query)
ofi-hledger babel

# Skip init and download (convert + query only)
ofi-hledger babel --no-init --no-download --no-balances bs
```

## Pipeline

Steps run in order: **init** → **download** → **balances** → **convert** → **query**.

All steps are enabled by default. Use `--no-init`, `--no-download`, `--no-balances`, `--no-convert` to skip individual steps. If no hledger args are provided, the pipeline runs without a query (useful for syncing).

Without `--from`, downloads from the oldest transaction date (set by init in config), which can be slow for accounts with long histories. Use `--from` to scope the download:

```bash
# Quarterly report — only download what you need
ofi-hledger babel --from 2025-01-01 is -Q
```

## Options

### `--no-init`

Skip the init step (`ofi-ledger-cli-init`).

### `--no-download`

Skip the download step (`ofi-csv-download`).

### `--no-balances`

Skip the balances step (`ofi-balance-download`).

### `--no-convert`

Skip the convert step (`ofi-hledger-convert`).

### `--from <date>` / `--to <date>`

Date range forwarded to download, balances (as `--date`), and convert.

```bash
ofi-hledger babel --from 2025-01-01 bs
ofi-hledger babel --from 2025-01-01 --to 2025-12-31 bs
```

### `--replace`

Replace existing files, forwarded to download and balances.

```bash
ofi-hledger babel --replace bs
```

### `--page-limit <n>`

Max transactions per file/request, forwarded to download. Defaults to 1000.

### `--rate-limit <n>`

Max requests per minute, forwarded to download and balances. Defaults to 60 with `PERSONAL_TOKEN`, 10 without.

## Argument Position

Because of `passThroughOptions()`, commander stops parsing ofi-hledger options after `<account-dir>` — everything after it is normally passed to hledger. To make the CLI more forgiving, ofi-hledger extracts its own flags from the pass-through args. All flags work in any position.

| Flag            | Type  | Forwarded to                              |
| --------------- | ----- | ----------------------------------------- |
| `--no-init`     | bool  | —                                         |
| `--no-download` | bool  | —                                         |
| `--no-balances` | bool  | —                                         |
| `--no-convert`  | bool  | —                                         |
| `--from`        | value | download, balances (as `--date`), convert |
| `--to`          | value | download, convert                         |
| `--replace`     | bool  | download, balances                        |
| `--page-limit`  | value | download                                  |
| `--rate-limit`  | value | download, balances                        |

`--from`/`--to` are NOT forwarded to hledger as `--begin`/`--end`. To filter the hledger query by date, pass `--begin`/`--end` directly as hledger args.

## Config

`ofi-hledger` reads from two sections in `ofi-ledger.config.js`:

- `ofi-hledger-convert.output` - journal file path (required)
- `ofi-hledger.args` - default arguments prepended to every query (optional)

```js
export default {
  'ofi-hledger-convert': {
    output: 'ofitech-host-transactions.journal',
    // ...
  },
  'ofi-hledger': {
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

Or add the alias to `ofi-hledger.args` in `ofi-ledger.config.js` to apply it by default.
