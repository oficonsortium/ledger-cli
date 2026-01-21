# Known Issues

This document tracks issues encountered while converting Open Collective CSV exports to hledger format.

## Fixed Issues

### 1. CREDIT EXPENSE transactions categorized as negative expenses

**Status:** Fixed
**Layer:** Rules (`rules-base.js`)

**Problem:** CREDIT EXPENSE transactions (where a collective receives money as expense reimbursement from another collective) were being mapped to `expenses:<scope>:disbursed` with negative amounts, creating confusing negative expense entries.

**Root Cause:** The code treated all EXPENSE transactions the same way regardless of CREDIT/DEBIT direction.

**Solution:** Added separate rules for CREDIT EXPENSE transactions, routing them to `revenues:<scope>:expense-income` instead.

**Files Changed:** `rules-base.js`

---

### 2. Refunds reducing wrong account type

**Status:** Fixed
**Layer:** Rules (`rules-base.js`)

**Problem:** When an expense reimbursement was refunded (DEBIT EXPENSE with REVERSE flag), the refund was going to `expenses:<scope>:disbursed` instead of reducing `revenues:<scope>:expense-income`. This caused:

- Inflated revenue numbers
- Phantom negative expenses
- Refunds not properly canceling original transactions

**Root Cause:** The refund detection logic didn't account for the direction of the original transaction.

**Solution:** Updated rule matching to check `isReverse == 'REVERSE'` and route refunds to the same account category as the original transaction:

- CREDIT EXPENSE refunds → reduce `expenses:<scope>:disbursed`
- DEBIT EXPENSE refunds → reduce `revenues:<scope>:expense-income`

**Files Changed:** `rules-base.js`

---

### 3. Over-broad refund detection using reverse_kind field

**Status:** Fixed
**Layer:** Rules (`rules-base.js`)

**Problem:** Initial fix for issue #2 used `reverse_kind == 'REFUND'` to detect refunds. This incorrectly flagged original transactions that were later refunded, because Open Collective sets `reverse_kind='REFUND'` on **both**:

- The original transaction (that was reversed)
- The reversal transaction itself

**Symptom:** Original CREDIT EXPENSE transactions marked as "REVERSED" were incorrectly treated as refunds, creating negative expenses.

**Root Cause:** Misunderstanding of Open Collective's data model:

- `is_reverse='REVERSE'` → This transaction IS a reversal
- `is_reversed='REVERSED'` → This transaction WAS reversed (it's the original)
- `reverse_kind='REFUND'` → Appears on BOTH original and reversal

**Solution:** Changed refund detection to only check `isReverse: 'REVERSE'` in rule match conditions, ignoring `reverse_kind`.

**Files Changed:** `rules-base.js`

### 6. Account name case inconsistencies in exports

**Status:** Fixed
**Layer:** `hledger-convert.js`

**Problem:** The same entity may appear with different case in the export, creating multiple hledger accounts for the same entity.

**Root Cause:** Open Collective CSV exports have inconsistent capitalization of common business suffixes (Inc, LLC, Corp, Ltd).

**Solution:** Added case normalization in `sanitizeAccountName()` to standardize common business suffixes:

- `inc` → `Inc`
- `llc` → `LLC`
- `corp` → `Corp`
- `ltd` → `Ltd`

**Files Changed:** `hledger-convert.js` → `sanitizeAccountName()` function

---

### 7. ADDED_FUNDS with same group_id being skipped

**Status:** Fixed
**Layer:** `hledger-convert.js`

**Problem:** Internal ADDED_FUNDS transactions (e.g., funding a sub-account) have both CREDIT and DEBIT rows with the same `group_id`. The fee merging logic was tracking processed groups by `group_id`, causing the second row to be skipped.

**Symptom:** Only CREDIT side of internal ADDED_FUNDS was processed, not the DEBIT side, causing balance discrepancies.

**Root Cause:** The `processRowsWithMergedFees()` function was using a `processed_groups` set keyed by `group_id`. When the CREDIT ADDED_FUNDS was processed, its group was marked as done, preventing the DEBIT row (with the same `group_id`) from being processed.

**Solution:** Changed tracking from `group_id` to `transaction_id`. Each transaction has a unique ID, so both CREDIT and DEBIT rows are processed independently while still allowing fee rows to be merged correctly.

**Files Changed:** `hledger-convert.js` → `processRowsWithMergedFees()` function

---

## Workarounds

### 4. Date filtering shows activity only, not cumulative balance

**Status:** Workaround available

**Problem:** Using `hledger -f file.journal bal -p 2026` shows only the balance changes during 2026, not the cumulative balance as of end of 2026. This caused confusion when comparing to test assertions.

**Example:**

- Test expects: `198,639.53 USD` (all-time balance)
- `-p 2026` showed: `159,173.12 USD` (2026 activity only)

**Workaround:** Use different query approaches depending on what you need:

- **Cumulative balance at year-end:** `bal -e 2027-01-01` or no date filter
- **Activity during year:** `bal -p 2026`
- **Income statement (revenues/expenses):** `is -p 2026` (correctly shows period activity)

---

### 5. Transactions dated in wrong year in source data

**Status:** Data quality issue - manual adjustment needed

**Problem:** Some transactions in the Open Collective export have dates that don't match when they should have been recorded. Transactions created in one fiscal period may actually belong to a prior period.

**Impact:** Overstates or understates revenue/expenses for a given period.

**Workaround:** When generating financial reports, manually adjust for known timing issues, or use `--from` filtering to set a clean start date with opening balances.

**Proper Fix:** Would require either:

- Correcting dates in source CSV before import
- Adding date override rules in hledger
- Adjusting journal entries post-generation

---

## Breaking Changes

### Tag names changed from snake_case to camelCase

**Status:** Changed in v2
**Layer:** `hledger-convert.js`

**Change:** Journal entry tags were renamed to use camelCase for ESLint compliance:

- `auto_reversed` → `autoReversed`
- `payee_name` → `payeeName`

**Impact:** Existing hledger queries or scripts that filter by these tag names will need to be updated.

**Example:**

```
# Old query
hledger reg tag:auto_reversed

# New query
hledger reg tag:autoReversed
```

---

## Open Issues

### 8. No automatic handling of fiscal year timing adjustments

**Status:** Open

**Problem:** There's no automated way to handle transactions that are in the export but should be attributed to a different fiscal period.

**Impact:** Manual reconciliation required for accurate period-over-period reporting.

**Possible Solutions:**

1. Pre-processing script to adjust dates in CSV
2. hledger's `date2` field for effective dates
3. Post-processing journal edits
4. Separate adjustment entries

---

### 9. Platform tip accounting treatment

**Status:** Open

**Problem:** Platform tips (PLATFORM_TIP/APPLICATION_FEE) are currently recorded as revenue and expense for the collective, but the collective is just a pass-through agent - it receives the tip from the donor and immediately pays it to the fiscal host.

**Current Implementation:**

- `PLATFORM_TIP` (CREDIT): `revenues:<scope>:platform-tips`
- `APPLICATION_FEE` (DEBIT): `expenses:<scope>:platform-fees`

**Issue:** This overstates the collective's revenue and expenses. The tip flows through but isn't really earned revenue.

**Alternatives Considered:**

1. **Liability approach**: Use `liabilities:platform-tip-debt` - accurate but invisible when merged
2. **Revenue/Expense (current)**: Visible for reconciliation but overstates activity
3. **Separate entries**: Don't merge, keep as individual journal entries with liability accounts

**Decision:** Using option 2 (revenue/expense) for now to ensure visibility for accountant reconciliation. May need to revisit based on accounting standards or auditor feedback.

**Files:** `rules-base.js` (platform-tip, application-fee rules)

---

### 10. Deleted expenses lose metadata in CSV export

**Status:** Open (Data quality issue)

**Problem:** When an expense is deleted on Open Collective, the underlying transaction remains in the CSV export but loses its expense metadata (`expenseType`, `accountingCode`, `accountingName`). This causes the transaction to be categorized under a generic `:other` suffix (e.g., `uncategorized-expenses:other`) instead of the correct category.

**Decision:** Let these transactions fall through to "other" categories rather than maintaining manual exception rules. The amounts are typically small and tracking them individually is not worth the maintenance overhead.

**Optional Workaround:** If specific categorization is needed, add exception rules by `transactionId` in a custom rules file.

**Proper Fix:** Open Collective should preserve expense metadata even when the expense is deleted, or provide a way to distinguish deleted-expense transactions.

---

### 11. Payment processor fees missing for pre-2024 transactions

**Status:** Open (Data export limitation)

**Problem:** The row-based CSV export format (where fees are separate rows with `kind=PAYMENT_PROCESSOR_FEE`) only includes fee rows starting from 2024. For transactions before 2024, payment processor fees are not exported as separate rows, causing them to be missing from the journal.

**Symptom:** In income statements, `payment-processor-fees` shows only negative amounts (refunds) for 2021-2023, with no corresponding positive expenses for the original fees.

**Workaround:** Use the column-based export format which includes "Payment Processor Fee" as a column on each transaction row.

**Implementation Note:** In column format, "Amount Single Column" is NET (after fees deducted). The tool grosses up revenue and records the fee as an expense, so both formats now show:

- Gross revenue (before fees)
- Processor fees as `expenses:<scope>:payment-processor-fees`

**Proper Fix:** Request an export from Open Collective that includes fee rows for all historical transactions (row-based format with complete data)

---

## Data Model Notes

### Open Collective CSV Fields

Understanding these fields is critical for correct transaction handling:

| Field          | Value      | Meaning                                  |
| -------------- | ---------- | ---------------------------------------- |
| `credit_debit` | `CREDIT`   | Money coming INTO this account           |
| `credit_debit` | `DEBIT`    | Money going OUT OF this account          |
| `is_reverse`   | `REVERSE`  | This transaction IS a reversal/refund    |
| `is_reversed`  | `REVERSED` | This transaction WAS reversed (original) |
| `reverse_kind` | `REFUND`   | Appears on BOTH original and reversal    |

### Transaction Type Combinations

| kind    | credit_debit | is_reverse | Meaning                        | Account                                         |
| ------- | ------------ | ---------- | ------------------------------ | ----------------------------------------------- |
| EXPENSE | DEBIT        | -          | Normal expense payout          | `expenses:<scope>:<category>:<expenseType>`     |
| EXPENSE | CREDIT       | -          | Expense reimbursement received | `revenues:<scope>:expense-income:<expenseType>` |
| EXPENSE | DEBIT        | REVERSE    | Refund of revenue received     | `revenues:<scope>:expense-income:<expenseType>` |
| EXPENSE | CREDIT       | REVERSE    | Refund of expense paid         | `expenses:<scope>:<category>:<expenseType>`     |
