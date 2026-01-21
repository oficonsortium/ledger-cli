/**
 * rules-base.js - Base rules for any Open Collective account
 *
 * Default Behavior:
 * - CREDIT transactions: asset +, revenue - (revenues:$scope:$kindKebab)
 * - DEBIT transactions: asset -, expense + (expenses:$scope:$kindKebab)
 *
 * Exception rules handle special cases like:
 * - Opening balances (equity)
 * - Expenses with accounting categories
 * - Liabilities (HOST_FEE_SHARE_DEBT, PLATFORM_TIP_DEBT)
 * - Merged transactions (fees that attach to parent)
 * - Payment processor fees (configurable account)
 *
 * Rule Evaluation:
 * - Rules are evaluated top-to-bottom
 * - First matching rule wins
 * - Default rules at the bottom catch anything not matched above
 * - Custom rules should be prepended to take priority
 */

export default {
  settings: {
    defaultCurrency: 'USD',
    defaultExpenseAccount: 'expenses:uncategorized-expenses',
    processorFeeAccount: 'expenses:payment-processor-fees',
  },

  // Deduplication rules - rows matching any rule are skipped
  // Empty by default; custom rules can add account-specific deduplication
  deduplication: [],

  rules: [
    // =========================================================================
    // EXCEPTION: Opening Balances (use equity, not revenue/expense)
    // =========================================================================

    // Opening entries (from-date): set up accounts
    {
      name: 'balance-carryforward-credit',
      match: { kind: 'BALANCE_CARRYFORWARD', creditDebit: 'CREDIT' },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'equity:opening-balances', amount: '${-amount}' },
          ],
        },
      ],
    },

    {
      name: 'balance-carryforward-debit',
      match: { kind: 'BALANCE_CARRYFORWARD', creditDebit: 'DEBIT' },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${-amount}' },
            { account: 'equity:opening-balances', amount: '${amount}' },
          ],
        },
      ],
    },

    // =========================================================================
    // EXCEPTION: Expenses (use accounting category and expense type)
    // =========================================================================

    // Settlement payment - pays down host-fee-share-debt liability
    {
      name: 'expense-settlement',
      match: { kind: 'EXPENSE', expenseType: 'SETTLEMENT', creditDebit: 'DEBIT' },
      entries: [
        {
          postings: [
            { account: 'liabilities:host-fee-share-debt', amount: '${absAmount}' },
            { account: '${scopedAsset}', amount: '${-absAmount}' },
          ],
        },
      ],
    },

    // Invoice payment received (expense-income)
    {
      name: 'expense-invoice-received',
      match: { kind: 'EXPENSE', creditDebit: 'CREDIT', isReverse: { not: 'REVERSE' } },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'revenues:${scope}:expense-income:${expenseTypeLower}', amount: '${-amount}' },
          ],
        },
      ],
    },

    // Standard expense payout (uses accounting category)
    {
      name: 'expense-payout',
      match: { kind: 'EXPENSE', creditDebit: 'DEBIT', isReverse: { not: 'REVERSE' } },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: '${scopedExpense}:${expenseTypeLower}', amount: '${-amount}' },
          ],
        },
      ],
    },

    // =========================================================================
    // EXCEPTION: Liabilities (not revenue/expense)
    // =========================================================================

    {
      name: 'host-fee-share-debt',
      match: { kind: 'HOST_FEE_SHARE_DEBT' },
      merge: true,
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'liabilities:host-fee-share-debt', amount: '${-amount}' },
          ],
        },
      ],
    },

    {
      name: 'platform-tip-debt',
      match: { kind: 'PLATFORM_TIP_DEBT' },
      merge: true,
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'liabilities:platform-tip-debt', amount: '${-amount}' },
          ],
        },
      ],
    },

    // =========================================================================
    // EXCEPTION: Merged fees (attach to parent transaction)
    // =========================================================================

    // Host fee paid by collective (merges into contribution/added-funds)
    {
      name: 'host-fee-paid',
      match: { kind: 'HOST_FEE', creditDebit: 'DEBIT' },
      merge: true,
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'expenses:${scope}:host-fees', amount: '${-amount}' },
          ],
        },
      ],
    },

    // Host fee received by fiscal host (merges into contribution/added-funds)
    {
      name: 'host-fee-received',
      match: { kind: 'HOST_FEE', creditDebit: 'CREDIT', isReverse: { not: 'REVERSE' } },
      merge: true,
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'revenues:${scope}:host-fees', amount: '${-amount}' },
          ],
        },
      ],
    },

    // Platform fee share paid by fiscal host
    {
      name: 'host-fee-share',
      match: { kind: 'HOST_FEE_SHARE' },
      merge: true,
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'expenses:${scope}:platform-fees', amount: '${-amount}' },
          ],
        },
      ],
    },

    // Platform tip received (merges into contribution)
    {
      name: 'platform-tip',
      match: { kind: 'PLATFORM_TIP', creditDebit: 'CREDIT' },
      merge: true,
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'revenues:${scope}:platform-tips', amount: '${-amount}' },
          ],
        },
      ],
    },

    // Application fee paid to platform (merges into contribution)
    {
      name: 'application-fee',
      match: { kind: 'APPLICATION_FEE', creditDebit: 'DEBIT' },
      merge: true,
      entries: [
        {
          postings: [
            { account: 'expenses:${scope}:platform-fees', amount: '${-amount}' },
            { account: '${scopedAsset}', amount: '${amount}' },
          ],
        },
      ],
    },

    // =========================================================================
    // EXCEPTION: Payment processor fees (configurable account)
    // =========================================================================

    {
      name: 'processor-fee',
      match: { kind: 'PAYMENT_PROCESSOR_FEE' },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: '${scopedProcessorFee}', amount: '${-amount}' },
          ],
          tags: { processor: '${paymentProcessor}' },
        },
      ],
    },

    {
      name: 'processor-cover',
      match: { kind: 'PAYMENT_PROCESSOR_COVER' },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: '${scopedProcessorFee}', amount: '${-amount}' },
          ],
          tags: { processor: '${paymentProcessor}' },
        },
      ],
    },

    {
      name: 'processor-dispute',
      match: { kind: 'PAYMENT_PROCESSOR_DISPUTE_FEE' },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: '${scopedProcessorFee}', amount: '${-amount}' },
          ],
          tags: { processor: '${paymentProcessor}' },
        },
      ],
    },

    // =========================================================================
    // DEFAULT: Standard CREDIT/DEBIT handling
    // These catch any transaction type not handled above
    // =========================================================================

    // Default CREDIT: asset increases, revenue recognized
    // Examples: CONTRIBUTION, ADDED_FUNDS, BALANCE_TRANSFER received
    {
      name: 'default-credit',
      match: { creditDebit: 'CREDIT', isReverse: { not: 'REVERSE' } },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'revenues:${scope}:${kindKebab}', amount: '${-amount}' },
          ],
        },
      ],
    },

    // Default DEBIT: asset decreases, expense recognized
    // Examples: CONTRIBUTION made, BALANCE_TRANSFER sent, ADDED_FUNDS out
    {
      name: 'default-debit',
      match: { creditDebit: 'DEBIT', isReverse: { not: 'REVERSE' } },
      entries: [
        {
          postings: [
            { account: '${scopedAsset}', amount: '${amount}' },
            { account: 'expenses:${scope}:${kindKebab}', amount: '${-amount}' },
          ],
        },
      ],
    },
  ],
};
