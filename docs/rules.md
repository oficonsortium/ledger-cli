# Rule System

Rules are defined in JavaScript modules that control how CSV rows are transformed into hledger journal entries.

## Rule Structure

```js
{
  name: 'contribution-received',
  match: {
    kind: 'CONTRIBUTION',
    creditDebit: 'CREDIT',
  },
  entries: [
    {
      postings: [
        { account: '${scopedAsset}', amount: '${amount}' },
        { account: 'revenues:${scope}:contributions', amount: '${-amount}' },
      ],
    },
  ],
}
```

Each rule has:

- **name** - Unique identifier (used in match reports)
- **match** - Conditions to match CSV rows (all AND-ed)
- **entries** - Journal entry templates with postings
- **merge** - (optional) If `true`, merge postings into parent transaction in same group

## Match Operators

| Operator      | Example                                   | Description                  |
| ------------- | ----------------------------------------- | ---------------------------- |
| Exact         | `kind: 'EXPENSE'`                         | Exact string match           |
| List (OR)     | `kind: ['EXPENSE', 'CONTRIBUTION']`       | Any of these values          |
| Negation      | `isReverse: { not: 'REVERSE' }`           | Not this value               |
| Contains      | `description: { contains: 'Grant' }`      | Case-sensitive substring     |
| Contains (OR) | `description: { contains: ['A', 'B'] }`   | Any substring matches        |
| iContains     | `description: { icontains: 'grant' }`     | Case-insensitive substring   |
| Not contains  | `expenseTags: { notContains: 'staff' }`   | Substring not present        |
| Not iContains | `expenseTags: { notIcontains: 'shared' }` | Case-insensitive not present |

### Matchable Fields

`kind`, `creditDebit`, `isReverse`, `isReversed`, `expenseType`, `expenseTags`, `description`, `oppositeHandle`, `accountHandle`, `paymentMethod`, `paymentProcessor`, `transactionId`, `reverseId`

## Template Variables

| Variable                 | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| `${amount}`              | Signed amount (preserves credit/debit sign)                |
| `${absAmount}`           | Absolute amount (always positive)                          |
| `${-amount}`             | Negated amount                                             |
| `${-absAmount}`          | Negated absolute amount                                    |
| `${scope}`               | Account scope (e.g., `operating`, `collectives:foo`)       |
| `${scopedAsset}`         | Full asset account path                                    |
| `${scopedExpense}`       | Full expense account path                                  |
| `${scopedProcessorFee}`  | Processor fee account with scope                           |
| `${oppositeScope}`       | Scope of the opposite party                                |
| `${oppositeScopedAsset}` | Asset account for the opposite party                       |
| `${expenseType}`         | Expense type (INVOICE, RECEIPT, SETTLEMENT)                |
| `${expenseTypeLower}`    | Lowercase expense type (`receipt` becomes `reimbursement`) |
| `${paymentProcessor}`    | Payment processor name (or `other`)                        |
| `${accountHandle}`       | Account slug                                               |
| `${oppositeHandle}`      | Opposite account slug                                      |
| `${accountName}`         | Account display name                                       |
| `${oppositeName}`        | Opposite account display name                              |
| `${description}`         | Transaction description                                    |
| `${transactionId}`       | Transaction ID                                             |
| `${groupId}`             | Group ID                                                   |

## Rule Evaluation

1. Rules are evaluated top-to-bottom; first match wins
2. Custom rules prepend to base rules (higher priority)
3. For `REVERSE` rows, auto-reverse matching tries:
   - Exact match (explicit reversal rules)
   - Match with flipped `creditDebit` (most common)
   - Match with same `creditDebit` (amounts negated)

## Deduplication

Prevents double-counting internal transfers. Rows matching any deduplication rule are skipped:

```js
deduplication: [{ kind: 'BALANCE_TRANSFER', creditDebit: 'CREDIT' }];
```

## Creating Custom Rules

Create a new file extending base rules:

```js
import baseRules from '../rules-base.js';

export default {
  settings: {
    ...baseRules.settings,
    mainAccount: 'myorg',
  },
  deduplication: [...baseRules.deduplication],
  rules: [
    // Custom rules first (higher priority)
    {
      name: 'grant-income',
      match: {
        kind: 'EXPENSE',
        expenseType: 'INVOICE',
        description: { icontains: 'grant' },
        creditDebit: 'CREDIT',
      },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'revenues:${scope}:grant-income', amount: '${-amount}' },
          ],
        },
      ],
    },
    // Then base rules (fallback)
    ...baseRules.rules,
  ],
};
```

Reference the rules file in `oc.config.js`:

```js
export default {
  'ofi-hledger-convert': {
    rules: './rules-myorg.js',
    // ...
  },
};
```

## Rules File Structure

```js
export default {
  settings: {
    defaultCurrency: 'USD',
    defaultExpenseAccount: 'expenses:uncategorized-expenses',
    processorFeeAccount: 'expenses:payment-processor-fees',
    mainAccount: 'myorg', // Optional
  },
  deduplication: [
    /* ... */
  ],
  rules: [
    /* ... */
  ],
};
```
