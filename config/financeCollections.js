/*
=========================================================
BIASHNET FINANCE COLLECTIONS
=========================================================

Employees / HR / Payroll / Expenses / Investor ledger /
Loans.

IMPORTANT:

These are brand-new collections. None of them rename or
replace anything in config/collections.js. The existing
marketplace/legacy-investment collections are never
touched by this module.

VERIFIED AGAINST LIVE FIRESTORE (read-only check) before
picking these names:

- "positions", "employees", "companyInfos", "loans",
  "approvalRequests", "financeWalletAccounts",
  "financeTransactionRecords", "financeWithdrawals" were
  all confirmed EMPTY — safe to use as-is.

- "expenses" already has live documents (written by the
  currently-unwired services/companyExpenses.js +
  routes/adminActual.js admin panel) — so this module uses
  "financeExpenses" instead.

- "lenders" already has live documents belonging to a
  DIFFERENT, unrelated feature (per-user lending-offer
  criteria, e.g. amountMin/amountMax/interestRate/terms
  keyed by userId) — so this module uses "financeLenders"
  instead.
=========================================================
*/

const FINANCE_COLLECTIONS = {

    POSITIONS: "positions",

    EMPLOYEES: "employees",

    COMPANY_INFOS: "companyInfos",

    EXPENSES: "financeExpenses",

    LENDERS: "financeLenders",

    LOANS: "loans",

    APPROVAL_REQUESTS: "approvalRequests",

    FINANCE_WALLET_ACCOUNTS: "financeWalletAccounts",

    FINANCE_TRANSACTION_RECORDS: "financeTransactionRecords",

    FINANCE_WITHDRAWALS: "financeWithdrawals",

};


/*
=========================================================
COMPANY TREASURY WALLET ID
=========================================================

A single financeWalletAccounts document represents
BIASHNET's own treasury. Payroll, expenses, loan
repayments debit it. Loan disbursements and any company
revenue credited into this ledger credit it.
=========================================================
*/

const COMPANY_WALLET_OWNER_ID = "company";


/*
=========================================================
WALLET ACCOUNT ID
=========================================================

A wallet belongs to an (owner, ownerType) PAIR, not just
an owner. The same person can be both an employee and an
investor, and those are two separate pots of money with
separate balances — keying wallets by uid alone made one
person's employee stipend and investor contributions the
same wallet.

This id is also what transaction records reference as
fromId/toId, so each wallet's ledger stays its own.
=========================================================
*/

function financeWalletId(ownerId, ownerType) {

    if (!ownerId) {

        throw new Error("Owner ID is required.");

    }

    if (!ownerType) {

        throw new Error("Owner type is required to identify a wallet.");

    }

    return `${ownerType}_${ownerId}`;

}


const COMPANY_WALLET_ID =
    financeWalletId(COMPANY_WALLET_OWNER_ID, "platform");


module.exports = {

    FINANCE_COLLECTIONS,

    COMPANY_WALLET_OWNER_ID,

    COMPANY_WALLET_ID,

    financeWalletId,

};
