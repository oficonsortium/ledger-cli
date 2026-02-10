# ofi-balance-download

Query account balances from the Open Collective GraphQL API and generate opening balance CSVs for use with `ofi-hledger-convert`.

## Authentication (optional)

Set `PERSONAL_TOKEN` in a `.env` file or as an environment variable to access private account data. Public data works without a token. Generate a token at https://opencollective.com/applications.

## Usage

```bash
ofi-balance-download <account-dir> [options]
```

The argument can be an account directory with `oc.config.js` or a slug used with `--host`.

```bash
# Account directory (reads host and from date from oc.config.js)
ofi-balance-download webpack
ofi-balance-download raft --date 2025-06-01

# Explicit host mode
ofi-balance-download --host opensource --date 2025-01-01

# List balances to stdout (no CSV file)
ofi-balance-download --host ofico --date 2025-01-01 --list
```

## Options

| Option                | Description                                        | Default                              |
| --------------------- | -------------------------------------------------- | ------------------------------------ |
| `--host <slug>`       | Host slug (e.g., opensource, ofico)                |                                      |
| `--date <date>`       | Balance date (YYYY-MM-DD)                          | config `ofi-csv-download.from`       |
| `-o, --output <file>` | Output CSV file                                    | `<slug>/<slug>-opening-balances.csv` |
| `--list`              | Output balances to stdout as a table (no CSV file) | off                                  |

When using an account directory with `oc.config.js`, `host` is read from `ofi-csv-download.host` and `date` falls back to `ofi-csv-download.from`. CLI flags always override.

## Modes

### Single account

Without `--host`, fetches the balance for one account and its children (events, projects). Only children with non-zero balances are included.

```bash
ofi-balance-download webpack --date 2025-01-01
```

### Fiscal host

With `--host` (or when `ofi-csv-download.host` is set in config), fetches the host's own balance plus all hosted account balances. Results are paginated automatically.

```bash
ofi-balance-download --host opensource --date 2025-01-01
```

## Output

Generates a CSV with `BALANCE_CARRYFORWARD` entries matching the column format used by `ofi-csv-download`. The output file is written to `<slug>/<slug>-opening-balances.csv` by default, so re-running always overwrites the previous balance file.

Use `--list` to print a table of slugs, amounts, and currencies to stdout instead of writing a CSV file.
