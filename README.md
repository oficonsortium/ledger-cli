# @ofi/ledger-cli

CLI tools to download [OFi / Open Collective](https://opencollective.com/) transactions and convert them to [hledger](https://hledger.org/) journals for double-entry accounting.

## Tools

| Command                                          | Description                                            |
| ------------------------------------------------ | ------------------------------------------------------ |
| [`ofi-hledger`](docs/hledger.md)                 | All-in-one: download, convert, and query journals      |
| [`ofi-csv-download`](docs/csv-download.md)       | Download transaction CSVs from the Open Collective API |
| [`ofi-hledger-convert`](docs/hledger-convert.md) | Convert CSVs to hledger journal files                  |
| [`ofi-balance-download`](docs/hledger.md)        | Download opening balances from the API                 |
| [`ofi-ledger-cli-init`](docs/hledger.md)         | Initialize an account directory                        |

Configuration: [`oc.config.js`](docs/oc-config.md) | Rules: [`rules`](docs/rules.md)

## Prerequisites

- Node.js 24+
- [hledger](https://hledger.org/) (`brew install hledger`)
- (Optional) A `PERSONAL_TOKEN` from https://opencollective.com/applications for private data

```bash
npm install -g @ofi/ledger-cli
```

## Quick start

```bash
ofi-hledger webpack --auto bs
```

This initializes the account directory, downloads transactions and opening balances, converts to a journal, then queries the balance sheet.

## Step by step

Each account lives in its own directory with an `oc.config.js`:

```
webpack/
  oc.config.js
  rules-webpack.js          # optional custom rules
  webpack-opening-balances.csv
  2025/
  2026/
  webpack-transactions.journal
```

### 1. Download transactions

```bash
ofi-csv-download webpack
```

### 2. Convert to journal

```bash
ofi-hledger-convert webpack
```

### 3. Query

```bash
ofi-hledger webpack bs    # Balance sheet
ofi-hledger webpack is    # Income statement
```

### Batch processing

```bash
ofi-hledger-convert ofico ofitech opensource raft phpfoundation
```

## Development

```bash
npm run lint          # ESLint
npm run lint:fix      # ESLint auto-fix
npm run prettier:check
npm run prettier:write
npm run graphql:update  # Fetch latest GraphQL schema
```

## License

MIT
