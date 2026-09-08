/*
=========================================================
BIASHNET FINANCE CONSTANTS
=========================================================

Central constants for the Employees / HR / Payroll /
Expenses / Investor ledger / Loans domain.

IMPORTANT:

Keep these values stable once they are stored in
Firestore. Changing an existing value can make historical
records difficult to interpret.
=========================================================
*/


/*
=========================================================
FINANCE TRANSACTION TYPES
=========================================================

Mirrors the transactionRecords.transactionType spec:

"Order Payment" | "Seller Payout" | "Platform Commission" |
"Investor Contribution" | "Investor Payout" |
"Loan Disbursement" | "Loan Repayment" |
"Business Expense" | "Business Purchase" | "Business Sale" |
"refund" | "Buyer Delivery"

This module only writes the rows this domain owns.
=========================================================
*/

const FINANCE_TRANSACTION_TYPES = {

    EMPLOYEE_STIPEND: "Employee Stipend",

    BUSINESS_EXPENSE: "Business Expense",

    INVESTOR_CONTRIBUTION: "Investor Contribution",

    INVESTOR_PAYOUT: "Investor Payout",

    LOAN_DISBURSEMENT: "Loan Disbursement",

    LOAN_REPAYMENT: "Loan Repayment",

};


/*
=========================================================
DIRECTIONS
=========================================================
*/

const FINANCE_DIRECTIONS = {

    PAYABLE: "payable",

    RECEIVABLE: "receivable",

    RECEIVED: "received",

    PAID: "paid",

};


/*
=========================================================
OWNER TYPES (financeWalletAccounts.ownerType /
transactionRecords fromType/toType)
=========================================================
*/

const FINANCE_OWNER_TYPES = {

    EMPLOYEE: "employee",

    INVESTOR: "investor",

    LENDER: "lender",

    PLATFORM: "platform",

    EXPENSE: "expense",

};


/*
=========================================================
FINANCE TRANSACTION STATUS
=========================================================
*/

const FINANCE_TRANSACTION_STATUS = {

    PENDING: "pending",

    COMPLETED: "completed",

    FAILED: "failed",

    REVERSED: "reversed",

};


/*
=========================================================
EMPLOYMENT STATUS
=========================================================
*/

const EMPLOYMENT_STATUS = {

    ACTIVE: "active",

    SUSPENDED: "suspended",

    TERMINATED: "terminated",

};


/*
=========================================================
EXPENSE STATUS
=========================================================
*/

const EXPENSE_STATUS = {

    PENDING_APPROVAL: "pending_approval",

    POSTED: "posted",

    REJECTED: "rejected",

};


/*
=========================================================
LOAN STATUS
=========================================================
*/

const LOAN_STATUS = {

    PENDING_APPROVAL: "pending_approval",

    ACTIVE: "active",

    REPAID: "repaid",

    REJECTED: "rejected",

};


/*
=========================================================
APPROVAL REQUEST STATUS / LEVEL
=========================================================
*/

const APPROVAL_STATUS = {

    PENDING: "pending",

    APPROVED: "approved",

    REJECTED: "rejected",

};


const APPROVAL_LEVEL = {

    ADMIN: "ADMIN",

    CEO: "CEO",

};


const APPROVAL_REQUEST_TYPES = {

    ROLE_CHANGE: "ROLE_CHANGE",

    EXPENSE: "EXPENSE",

    PAYROLL_RUN: "PAYROLL_RUN",

    LOAN_ENTRY: "LOAN_ENTRY",

    INVESTOR_PAYOUT: "INVESTOR_PAYOUT",

};


/*
=========================================================
EMPLOYEE ROLE KEYS
=========================================================

Boolean flags stored on employees/{uid}.roles

IMPORTANT:

Role grants themselves always go through the approval
workflow (HR proposes, CEO approves). This list only
defines the valid role keys.
=========================================================
*/

const EMPLOYEE_ROLE_KEYS = [

    "ceo",

    "hr",

    "accountant",

    "techlead",

    "marketing",

    "admin",

    "logistics",

];


/*
=========================================================
APPROVAL THRESHOLDS (KES)
=========================================================

PLACEHOLDER VALUES.

These are business decisions — tune them after review.
Amounts at/above EXPENSE_APPROVAL_THRESHOLD require Admin
approval. Amounts at/above EXPENSE_CEO_APPROVAL_THRESHOLD
require CEO approval instead. Same pattern for payroll
runs and investor payouts.
=========================================================
*/

const EXPENSE_APPROVAL_THRESHOLD = 5000;

const EXPENSE_CEO_APPROVAL_THRESHOLD = 50000;

const PAYROLL_APPROVAL_THRESHOLD = 20000;

const INVESTOR_PAYOUT_APPROVAL_THRESHOLD = 10000;

const LOAN_ENTRY_ALWAYS_REQUIRES_CEO = true;


module.exports = {

    FINANCE_TRANSACTION_TYPES,

    FINANCE_DIRECTIONS,

    FINANCE_OWNER_TYPES,

    FINANCE_TRANSACTION_STATUS,

    EMPLOYMENT_STATUS,

    EXPENSE_STATUS,

    LOAN_STATUS,

    APPROVAL_STATUS,

    APPROVAL_LEVEL,

    APPROVAL_REQUEST_TYPES,

    EMPLOYEE_ROLE_KEYS,

    EXPENSE_APPROVAL_THRESHOLD,

    EXPENSE_CEO_APPROVAL_THRESHOLD,

    PAYROLL_APPROVAL_THRESHOLD,

    INVESTOR_PAYOUT_APPROVAL_THRESHOLD,

    LOAN_ENTRY_ALWAYS_REQUIRES_CEO,

};
