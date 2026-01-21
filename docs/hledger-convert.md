# ofi-hledger-convert

Rule-based Open Collective CSV to hledger journal transformer.

## Usage

```bash
ofi-hledger-convert <input...> [options]
```

Input can be one or more CSV files, glob patterns, directories, or account directories with `oc.config.js`.

```bash
# Account directory (uses oc.config.js)
ofi-hledger-convert ofitech
ofi-hledger-convert ofico ofitech opensource

# Single file
ofi-hledger-convert export.csv -o output.journal

# Glob pattern
ofi-hledger-convert "ofitech/2024/**/*.csv" -o journal.hledger

# Directory (processes all CSVs recursively)
ofi-hledger-convert ofitech/ -o journal.hledger
```

## Options

| Option                    | Description                                  | Default           |
| ------------------------- | -------------------------------------------- | ----------------- |
| `-o, --output <file>`     | Output journal file                          | stdout            |
| `-r, --rules <file>`      | Rules configuration file                     | `./rules-base.js` |
| `--main-account <handle>` | Main account handle for nesting sub-accounts | directory name    |
| `--from <date>`           | Skip rows before this date (YYYY-MM-DD)      | config `from`     |
| `--fee-format <format>`   | `auto`, `rows`, or `columns`                 | `auto`            |
| `--date-field <field>`    | Date column: `transaction` or `effective`    | `transaction`     |
| `--stats`                 | Print rule match statistics                  | off               |

When using an account directory with `oc.config.js`, these options are loaded from config. CLI flags always override config values.

### Date fields

- `transaction` — Uses `Date & Time` (transaction creation date, default)
- `effective` — Uses `Effective Date & Time` (settlement/clearing date)

These dates can differ, for example platform tips may show the transaction date on the day of the original contribution but the effective date days later when the tip is settled.

## Account Structure

With `--main-account`, accounts are nested by type:

| Account Type        | Path                          |
| ------------------- | ----------------------------- |
| organization (main) | `<main>`                      |
| collective          | `<main>:collectives:<handle>` |
| fund                | `<main>:funds:<handle>`       |
| event               | `<main>:events:<handle>`      |
| project             | `<main>:projects:<handle>`    |

The full account hierarchy:

```
assets:opencollective:<scope>              # Collective balances
revenues:<scope>:contributions             # Donations received
revenues:<scope>:added-funds               # Funds added (interest, transfers in)
expenses:<scope>:disbursed                 # Payments to vendors/contractors
expenses:<scope>:host-fees                 # Fiscal host fees
expenses:<scope>:payment-processor-fees    # Stripe/PayPal/Wise fees
liabilities:host-fee-share-debt            # Deferred platform fees
```

## Fee Formats

| Format    | Description                                                  |
| --------- | ------------------------------------------------------------ |
| `auto`    | Auto-detect based on CSV content (default)                   |
| `rows`    | Fees as separate `PAYMENT_PROCESSOR_FEE` rows (recommended)  |
| `columns` | Fees embedded in "Payment Processor Fee" column (deprecated) |

## Transaction Kinds

| Kind                            | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| `CONTRIBUTION`                  | Donation/contribution received or made            |
| `EXPENSE`                       | Expense payout (INVOICE, RECEIPT, SETTLEMENT)     |
| `ADDED_FUNDS`                   | External funding, bank interest, manual additions |
| `BALANCE_TRANSFER`              | Internal transfer between accounts                |
| `HOST_FEE`                      | Fee paid by collective to fiscal host             |
| `HOST_FEE_SHARE`                | Platform fee paid by host to Open Collective      |
| `HOST_FEE_SHARE_DEBT`           | Deferred platform fee liability                   |
| `PAYMENT_PROCESSOR_FEE`         | Stripe/PayPal/Wise fees                           |
| `PAYMENT_PROCESSOR_COVER`       | Donor-covered processor fees                      |
| `PAYMENT_PROCESSOR_DISPUTE_FEE` | Chargeback fees                                   |
