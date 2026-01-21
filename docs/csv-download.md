# ofi-csv-download

Download Open Collective transaction CSVs from the REST API, batched by day or month.

## Authentication (optional)

Set `PERSONAL_TOKEN` in a `.env` file or as an environment variable to access private account data. Public data works without a token. Generate a token at https://opencollective.com/applications.

## Usage

```bash
ofi-csv-download <slug> [options]
```

The slug can be an account slug or a directory with `oc.config.js`.

```bash
# Using config
ofi-csv-download ofitech

# Direct slug
ofi-csv-download ofitech --host

# Date range
ofi-csv-download ofitech --host --from 2024-01-01 --to 2024-12-31

# Last 7 days
ofi-csv-download myorg --days 7

# Preview
ofi-csv-download ofitech --dry-run
```

## Options

| Option                  | Description                                        | Default                      |
| ----------------------- | -------------------------------------------------- | ---------------------------- |
| `--host`                | Use `hostTransactions` endpoint (for fiscal hosts) | `false`                      |
| `--from <date>`         | Start date (YYYY-MM-DD)                            | January 1st of previous year |
| `--to <date>`           | End date (YYYY-MM-DD)                              | today                        |
| `--days <n>`            | Number of days (overrides `--from`)                |                              |
| `--daily`               | Download by day instead of by month                | `false`                      |
| `--yearly`              | Download by year instead of by month               | `false`                      |
| `--strategy <strategy>` | Download strategy: `daily`, `monthly`, `yearly`    | `monthly`                    |
| `--replace`             | Replace existing files                             | `false`                      |
| `--dry-run`             | Show what would be downloaded                      | `false`                      |

When using an account directory with `oc.config.js`, `host`, `daily`, `yearly`, `strategy`, and `from` are loaded from config. CLI flags always override.

## Strategies

### Monthly (default)

One file per month: `<slug>/YYYY/<slug>-YYYY-MM-transactions.csv`

### Daily

One file per day: `<slug>/YYYY/MM/<slug>-YYYY-MM-DD-transactions.csv`

Use `--daily` for finer granularity.

### Yearly

One file per year: `<slug>/YYYY/<slug>-YYYY-transactions.csv`

Use `--yearly` or `--strategy yearly` for coarser granularity.

## Behavior

- Existing files are skipped (use `--replace` to re-download)
- Today's file is always re-downloaded (incomplete day)
- Paginated files are created when a day/month exceeds 1000 rows
- Incomplete pagination sets are detected and re-downloaded
