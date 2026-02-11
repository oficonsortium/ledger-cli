# oc.config.js

Per-account configuration file. Place in each account directory to set defaults for all tools.

## Format

```js
export default {
  'ofi-csv-download': {
    /* ... */
  },
  'ofi-hledger-convert': {
    /* ... */
  },
  hledger: {
    /* ... */
  },
};
```

Each section is keyed by tool name. CLI flags always override config values.

## Top-level fields

| Key    | Type   | Description                                                        |
| ------ | ------ | ------------------------------------------------------------------ |
| `slug` | string | Account slug on Open Collective. Used by all tools as the default. |

When set, `slug` is used by `ofi-csv-download` for API requests, `ofi-hledger-convert` as the main account handle, and `ofi-balance-download` for balance queries. Without it, tools fall back to the directory name.

## Sections

### ofi-csv-download

| Key          | Type    | Description                                                      |
| ------------ | ------- | ---------------------------------------------------------------- |
| `host`       | boolean | Use `hostTransactions` endpoint                                  |
| `strategy`   | string  | Download strategy: `daily`, `monthly`, `yearly`                  |
| `from`       | string  | Default start date (YYYY-MM-DD)                                  |
| `rate-limit` | number  | Max requests per minute (default: `60` with token, `10` without) |

### ofi-hledger-convert

| Key            | Type   | Description                                                                   | Default                  |
| -------------- | ------ | ----------------------------------------------------------------------------- | ------------------------ |
| `input`        | string | CSV file or glob pattern (relative to account dir)                            | `**/*.csv`               |
| `output`       | string | Journal output file (relative to account dir)                                 | `transactions.journal`   |
| `rules`        | string | Rules file path (relative to account dir)                                     | packaged `rules-base.js` |
| `main-account` | string | Override main account handle (defaults to top-level `slug` or directory name) | `slug` or dir name       |
| `fee-format`   | string | `auto`, `rows`, or `columns`                                                  | `auto`                   |
| `from`         | string | Skip rows before this date (YYYY-MM-DD)                                       | —                        |
| `to`           | string | Skip rows after this date (YYYY-MM-DD)                                        | —                        |
| `date-field`   | string | Date column: `transaction` or `effective`                                     | `transaction`            |

The `date-field` option controls which CSV date column is used for journal entries:

- `transaction` — Uses `Date & Time` (transaction creation date, default)
- `effective` — Uses `Effective Date & Time` (settlement/clearing date)

The `from` and `to` options filter CSV rows by date. Both fall back to `ofi-csv-download.from` and `ofi-csv-download.to` respectively if not set.

### hledger

| Key    | Type     | Description                                        |
| ------ | -------- | -------------------------------------------------- |
| `args` | string[] | Default arguments prepended to every hledger query |

## Examples

### Fiscal host with monthly downloads

```js
// ofitech/oc.config.js
export default {
  slug: 'ofitech',
  'ofi-csv-download': { host: true, strategy: 'monthly', from: '2024-01-01' },
  'ofi-hledger-convert': {
    output: 'ofitech-host-transactions.journal',
    rules: './rules-ofitech.js',
  },
};
```

### Organization with custom rules

```js
// ofico/oc.config.js
export default {
  slug: 'ofico',
  'ofi-csv-download': { host: true, strategy: 'yearly', from: '2024-10-01' },
  'ofi-hledger-convert': {
    output: 'ofico-host-transactions.journal',
    rules: './rules-ofico.js',
    'date-field': 'transaction',
  },
};
```

### Single collective

```js
// babel/oc.config.js
export default {
  slug: 'babel',
  'ofi-csv-download': { strategy: 'monthly', from: '2025-01-01' },
  'ofi-hledger-convert': {
    output: 'babel-transactions.journal',
  },
};
```

### With default hledger aliases

```js
// ofitech/oc.config.js
export default {
  slug: 'ofitech',
  'ofi-csv-download': { host: true },
  'ofi-hledger-convert': {
    output: 'ofitech-host-transactions.journal',
    rules: './rules-ofitech.js',
  },
  hledger: {
    args: ['--alias', '/^(revenues|expenses):(operating|collectives:[^:]+):(.*)$/=\\1:\\3'],
  },
};
```
