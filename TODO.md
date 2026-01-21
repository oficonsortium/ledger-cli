# TODO

## Future: Accrual accounting for HOST_FEE_SHARE transactions

Currently using cash-basis accounting for host fee share transactions. This is simpler and works well for most cases.

### Transaction types

- `HOST_FEE_SHARE` - Platform fee paid by fiscal host to OFiTech
- `HOST_FEE_SHARE_DEBT` - Liability for deferred payment (not always present)
- `EXPENSE` with `expenseType: SETTLEMENT` - Payment to clear accumulated debt

### Why it's complex

HOST_FEE_SHARE does not always have a corresponding HOST_FEE_SHARE_DEBT. Only when HOST_FEE_SHARE_DEBT is created do we know the payment is deferred.

This means:

- HOST_FEE_SHARE alone = direct expense (no liability)
- HOST_FEE_SHARE_DEBT = liability created, to be paid later
- EXPENSE SETTLEMENT = pays down the accumulated liability

### Current approach (cash-basis)

```javascript
// Direct expense - works for both cases
{ kind: 'HOST_FEE_SHARE' } → expenses:${scope}:platform-fees:host-fee-share

// Liability created (deferred payment)
{ kind: 'HOST_FEE_SHARE_DEBT' } → liabilities:host-fee-share-debt

// Settlement clears the liability
{ kind: 'EXPENSE', expenseType: 'SETTLEMENT' } → liabilities:host-fee-share-debt (debit)
```

### Potential accrual approach

Would need to detect paired transactions (same group_id) to handle correctly:

- If HOST_FEE_SHARE has matching HOST_FEE_SHARE_DEBT → pay down liability
- If HOST_FEE_SHARE has no matching debt → direct expense

This would require changes to the rule engine to support cross-row lookups.

## Future: Accrual accounting for custom rules

Currently using cash-basis accounting for all custom rules (e.g., ofico/rules-ofico.js). This was a deliberate choice to keep things simple and leverage the auto-reverse logic.

### Why cash-basis was chosen

1. **Auto-reverse compatibility**: The auto-reverse logic for REVERSE transactions works correctly with `${amount}` (which preserves sign) but NOT with `${absAmount}` (which loses sign information). Accrual rules that use `${absAmount}` would require explicit refund rules for each case.

2. **Simplicity**: Cash-basis rules are single-step (one entry per transaction), while accrual rules require two steps (liability/receivable creation, then settlement).

3. **Adequate for current needs**: Cash-basis provides accurate totals; accrual is only needed for tracking outstanding receivables/payables at a point in time.

### What accrual would enable

1. **Revenue recognition** (grants, sponsorships, membership fees)
   - Current: Cash received → Revenue
   - Accrual: Invoice sent → A/R + Revenue, Cash received → Cash + A/R reduction

2. **Intercompany transactions** (shared staff, cost recovery)
   - Current: Cash received → Expense reduction (contra-expense)
   - Accrual: Invoice approved → Intercompany A/R + Expense, Cash received → Cash + A/R reduction

3. **Expense tracking**
   - Current: Cash paid → Expense
   - Accrual: Expense approved → Expense + A/P, Cash paid → A/P + Cash reduction

### Implementation requirements

If accrual is needed in the future:

- Either fix the auto-reverse logic to handle `${absAmount}` correctly
- Or add explicit refund rules for each accrual rule (increases maintenance)
- Or add cross-row lookup capability to detect paired transactions

## OFiCo: Custom account categorization

Open Collective's default categories (ADDED_FUNDS, CONTRIBUTION, EXPENSE) don't map directly to accounting categories. Custom rules in ofico/rules-ofico.js address this.

### What's been done

- **Interest income**: Wise Interest → `revenues:${scope}:interest-income`
- **Internal transfers**: ADDED_FUNDS between OFiCo accounts → balance transfer (not revenue)
- **Grant income**: Grant funding invoices → `revenues:${scope}:grant-income`
- **Sponsorship income**: Sponsorship invoices → `revenues:${scope}:sponsorship-income`
- **Membership fees**: Membership Fee invoices → `revenues:${scope}:membership-fees`
- **Donations**: Exit to Community and other donations → `revenues:${scope}:donations`
- **Cost recovery**: Shared staff, Klippa, travel reimbursements → contra-expense

### What could be added

- **External contributions**: Currently goes to generic `contributions`. Could map to specific categories based on tier name or description.
- **Added funds from specific sources**: Could categorize by source organization or description (e.g., foundation grants vs. corporate funding).
- **Chart of Accounts integration**: When Open Collective adds built-in Chart of Accounts support, these custom rules may become unnecessary.
