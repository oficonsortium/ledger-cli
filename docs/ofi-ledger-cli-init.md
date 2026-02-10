# ofi-ledger-cli-init

Initialize an account directory with `oc.config.js` from the Open Collective GraphQL API.

## Authentication (optional)

Set `PERSONAL_TOKEN` in a `.env` file or as an environment variable to access private account data. Public data works without a token. Generate a token at https://opencollective.com/applications.

## Usage

```bash
ofi-ledger-cli-init <slug> [options]
```

```bash
ofi-ledger-cli-init ofitech
ofi-ledger-cli-init phpfoundation
ofi-ledger-cli-init webpack --dry-run
```

## Options

| Option      | Description                  |
| ----------- | ---------------------------- |
| `--dry-run` | Print config without writing |

## Behavior

Queries the Open Collective API to determine:

- Account type, currency, and hosting status
- Oldest transaction date (used as `ofi-csv-download.from`)
- Transaction volume for the last month and last year

A download strategy is picked based on transaction volume:

| Volume        | Strategy  |
| ------------- | --------- |
| <= 1000/year  | `yearly`  |
| <= 1000/month | `monthly` |
| > 1000/month  | `daily`   |

The generated `oc.config.js` includes `slug`, `ofi-csv-download` (host, strategy, from), and `ofi-hledger-convert` (output) sections.

### Updating existing config

If `oc.config.js` already exists, missing keys are filled in without overwriting existing values. This lets you re-run init to pick up new defaults while preserving your customizations.
