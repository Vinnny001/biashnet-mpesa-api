const {
    db,
    FieldValue,
} = require("../config/firebase");

const { FINANCE_COLLECTIONS, COMPANY_WALLET_ID } = require("../config/financeCollections");

const {
    LOAN_STATUS,
    APPROVAL_LEVEL,
    APPROVAL_REQUEST_TYPES,
    FINANCE_TRANSACTION_TYPES,
    FINANCE_DIRECTIONS,
    FINANCE_OWNER_TYPES,
} = require("../config/financeConstants");

const {
    creditFinanceWallet,
    debitFinanceWallet,
} = require("./financeWalletService");

const { createFinanceTransaction } = require("./financeLedgerService");

const { createApprovalRequest } = require("./approvalService");

const { createNotification } = require("./notificationService");


/*
=========================================================
LOAN / LENDER SERVICE
=========================================================

lenders/{lenderId}
{
  lenderId, name, phone, email, status, createdAt
}

loans/{loanId}
{
  loanId, lenderId, principal, interestRate, termMonths,
  status, disbursedAt, repaidAmount, createdAt
}

Loans are Accountant-recorded manually (no STK/B2C
automation in this pass) and always require CEO approval
before disbursement is posted to the ledger.
=========================================================
*/

async function createLender({ name, phone, email, createdBy }) {

    if (!name || !String(name).trim()) {

        throw new Error("Lender name is required.");

    }

    const lenderRef = db.collection(FINANCE_COLLECTIONS.LENDERS).doc();

    const data = {

        lenderId: lenderRef.id,

        name: String(name).trim(),

        phone: phone || null,

        email: email || null,

        status: "active",

        createdBy: createdBy || null,

        createdAt: FieldValue.serverTimestamp(),

    };

    await lenderRef.set(data);

    return { id: lenderRef.id, ...data };

}


async function listLenders() {

    const snapshot = await db.collection(FINANCE_COLLECTIONS.LENDERS).get();

    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

}


async function createLoan({

    lenderId,

    principal,

    interestRate = 0,

    termMonths = null,

    requestedBy,

}) {

    const lenderSnap = await db.collection(FINANCE_COLLECTIONS.LENDERS).doc(lenderId).get();

    if (!lenderSnap.exists) {

        throw new Error("Lender not found.");

    }

    const numericPrincipal = Number(principal);

    if (!Number.isFinite(numericPrincipal) || numericPrincipal <= 0) {

        throw new Error("Loan principal must be greater than zero.");

    }

    const loanRef = db.collection(FINANCE_COLLECTIONS.LOANS).doc();

    const loan = {

        loanId: loanRef.id,

        lenderId,

        principal: Number(numericPrincipal.toFixed(2)),

        interestRate: Number(interestRate) || 0,

        termMonths: termMonths || null,

        status: LOAN_STATUS.PENDING_APPROVAL,

        disbursedAt: null,

        repaidAmount: 0,

        createdBy: requestedBy,

        createdAt: FieldValue.serverTimestamp(),

    };

    await loanRef.set(loan);

    const request = await createApprovalRequest({

        requestType: APPROVAL_REQUEST_TYPES.LOAN_ENTRY,

        requestedBy,

        targetId: loanRef.id,

        requiredLevel: APPROVAL_LEVEL.CEO,

        payload: { loanId: loanRef.id, entryType: "disbursement" },

        description: `Loan disbursement from lender ${lenderId} — KES ${loan.principal}`,

    });

    return { id: loanRef.id, ...loan, approvalRequest: request };

}


/* ========================================================
   APPLY LOAN ENTRY (called by approvalService on approve)
======================================================== */

async function applyLoanEntry(payload) {

    const { loanId, entryType, amount } = payload;

    const loanRef = db.collection(FINANCE_COLLECTIONS.LOANS).doc(loanId);

    const snap = await loanRef.get();

    if (!snap.exists) {

        throw new Error("Loan not found.");

    }

    const loan = snap.data();

    if (entryType === "disbursement") {

        if (loan.status !== LOAN_STATUS.PENDING_APPROVAL) {

            return { loanId, alreadyProcessed: true };

        }

        await creditFinanceWallet({

            ownerId: COMPANY_WALLET_ID,

            ownerType: FINANCE_OWNER_TYPES.PLATFORM,

            amount: loan.principal,

        });

        await createFinanceTransaction({

            transactionId: `LOAN_DISBURSE_${loanId}`,

            transactionType: FINANCE_TRANSACTION_TYPES.LOAN_DISBURSEMENT,

            amount: loan.principal,

            direction: FINANCE_DIRECTIONS.RECEIVED,

            fromId: loan.lenderId,

            fromType: FINANCE_OWNER_TYPES.LENDER,

            toId: COMPANY_WALLET_ID,

            toType: FINANCE_OWNER_TYPES.PLATFORM,

            method: "bank",

            description: `Loan disbursement for loan ${loanId}`,

        });

        await loanRef.update({

            status: LOAN_STATUS.ACTIVE,

            disbursedAt: FieldValue.serverTimestamp(),

        });

        return { loanId, status: LOAN_STATUS.ACTIVE };

    }

    if (entryType === "repayment") {

        const numericAmount = Number(amount);

        await debitFinanceWallet({

            ownerId: COMPANY_WALLET_ID,

            ownerType: FINANCE_OWNER_TYPES.PLATFORM,

            amount: numericAmount,

        });

        const repaymentsCount = Number(loan.repaymentsCount || 0) + 1;

        await createFinanceTransaction({

            transactionId: `LOAN_REPAY_${loanId}_${Date.now()}`,

            transactionType: FINANCE_TRANSACTION_TYPES.LOAN_REPAYMENT,

            amount: numericAmount,

            direction: FINANCE_DIRECTIONS.PAID,

            fromId: COMPANY_WALLET_ID,

            fromType: FINANCE_OWNER_TYPES.PLATFORM,

            toId: loan.lenderId,

            toType: FINANCE_OWNER_TYPES.LENDER,

            method: "bank",

            description: `Loan repayment #${repaymentsCount} for loan ${loanId}`,

        });

        const newRepaidAmount = Number(
            (Number(loan.repaidAmount || 0) + numericAmount).toFixed(2)
        );

        const fullyRepaid = newRepaidAmount >= loan.principal;

        await loanRef.update({

            repaidAmount: newRepaidAmount,

            repaymentsCount,

            status: fullyRepaid ? LOAN_STATUS.REPAID : loan.status,

        });

        return { loanId, repaidAmount: newRepaidAmount, status: fullyRepaid ? LOAN_STATUS.REPAID : loan.status };

    }

    throw new Error(`Unknown loan entry type: ${entryType}.`);

}


async function requestLoanRepayment({ loanId, amount, requestedBy }) {

    const loanSnap = await db.collection(FINANCE_COLLECTIONS.LOANS).doc(loanId).get();

    if (!loanSnap.exists) {

        throw new Error("Loan not found.");

    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {

        throw new Error("Repayment amount must be greater than zero.");

    }

    const request = await createApprovalRequest({

        requestType: APPROVAL_REQUEST_TYPES.LOAN_ENTRY,

        requestedBy,

        targetId: loanId,

        requiredLevel: APPROVAL_LEVEL.CEO,

        payload: { loanId, entryType: "repayment", amount: numericAmount },

        description: `Loan repayment for loan ${loanId} — KES ${numericAmount}`,

    });

    return { queuedForApproval: true, approvalRequest: request };

}


async function listLoans() {

    const snapshot = await db.collection(FINANCE_COLLECTIONS.LOANS).get();

    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

}


module.exports = {

    createLender,

    listLenders,

    createLoan,

    applyLoanEntry,

    requestLoanRepayment,

    listLoans,

};
