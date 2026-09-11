const {
    db,
    FieldValue,
} = require("../config/firebase");

const { FINANCE_COLLECTIONS, COMPANY_WALLET_ID, COMPANY_WALLET_OWNER_ID } = require("../config/financeCollections");

const {
    EXPENSE_STATUS,
    APPROVAL_LEVEL,
    APPROVAL_REQUEST_TYPES,
    FINANCE_TRANSACTION_TYPES,
    FINANCE_DIRECTIONS,
    FINANCE_OWNER_TYPES,
    EXPENSE_APPROVAL_THRESHOLD,
    EXPENSE_CEO_APPROVAL_THRESHOLD,
} = require("../config/financeConstants");

const { debitFinanceWallet } = require("./financeWalletService");

const { createFinanceTransaction } = require("./financeLedgerService");

const { createApprovalRequest } = require("./approvalService");

const { createNotification } = require("./notificationService");


/*
=========================================================
EXPENSE SERVICE
=========================================================

expenses/{expenseId}

{
  expenseId, transactionId, recordedBy, category, amount,
  description, status, approvedBy, createdAt
}
=========================================================
*/

const VALID_CATEGORIES = [

    "rent",
    "salaries",
    "marketing",
    "utilities",
    "logistics",
    "dividend",
    "transportation",
    "transaction costs",
    "other",

];


async function postExpenseDebit(expenseRef, expense) {

    const transactionId = `EXPENSE_${expenseRef.id}`;

    await debitFinanceWallet({

        ownerId: COMPANY_WALLET_OWNER_ID,

        ownerType: FINANCE_OWNER_TYPES.PLATFORM,

        amount: expense.amount,

    });

    await createFinanceTransaction({

        transactionId,

        transactionType: FINANCE_TRANSACTION_TYPES.BUSINESS_EXPENSE,

        amount: expense.amount,

        direction: FINANCE_DIRECTIONS.PAID,

        fromId: COMPANY_WALLET_ID,

        fromType: FINANCE_OWNER_TYPES.PLATFORM,

        toId: expenseRef.id,

        toType: FINANCE_OWNER_TYPES.EXPENSE,

        method: "wallet",

        description: expense.description,

        metadata: { category: expense.category, recordedBy: expense.recordedBy },

    });

    await expenseRef.update({

        transactionId,

        status: EXPENSE_STATUS.POSTED,

        updatedAt: FieldValue.serverTimestamp(),

    });

}


async function createExpense({

    category,

    amount,

    description,

    recordedBy,

}) {

    if (!VALID_CATEGORIES.includes(String(category))) {

        throw new Error(`Category must be one of: ${VALID_CATEGORIES.join(", ")}.`);

    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {

        throw new Error("Expense amount must be greater than zero.");

    }

    if (!description || !String(description).trim()) {

        throw new Error("Expense description is required.");

    }

    const expenseRef = db.collection(FINANCE_COLLECTIONS.EXPENSES).doc();

    const expense = {

        expenseId: expenseRef.id,

        transactionId: null,

        recordedBy,

        category,

        amount: Number(numericAmount.toFixed(2)),

        description: String(description).trim(),

        status: EXPENSE_STATUS.PENDING_APPROVAL,

        approvedBy: null,

        createdAt: FieldValue.serverTimestamp(),

        updatedAt: FieldValue.serverTimestamp(),

    };

    await expenseRef.set(expense);

    if (expense.amount < EXPENSE_APPROVAL_THRESHOLD) {

        await postExpenseDebit(expenseRef, expense);

        const snap = await expenseRef.get();

        return { id: expenseRef.id, ...snap.data() };

    }

    const requiredLevel =
        expense.amount >= EXPENSE_CEO_APPROVAL_THRESHOLD
            ? APPROVAL_LEVEL.CEO
            : APPROVAL_LEVEL.ADMIN;

    const request = await createApprovalRequest({

        requestType: APPROVAL_REQUEST_TYPES.EXPENSE,

        requestedBy: recordedBy,

        targetId: expenseRef.id,

        requiredLevel,

        payload: { expenseId: expenseRef.id },

        description: `Expense: ${expense.category} — KES ${expense.amount}`,

    });

    const snap = await expenseRef.get();

    return { id: expenseRef.id, ...snap.data(), approvalRequest: request };

}


/* ========================================================
   APPLY (called by approvalService on approve)
======================================================== */

async function applyExpensePosting(payload) {

    const { expenseId } = payload;

    const expenseRef = db.collection(FINANCE_COLLECTIONS.EXPENSES).doc(expenseId);

    const snap = await expenseRef.get();

    if (!snap.exists) {

        throw new Error("Expense not found.");

    }

    const expense = snap.data();

    if (expense.status === EXPENSE_STATUS.POSTED) {

        return { expenseId, alreadyPosted: true };

    }

    await postExpenseDebit(expenseRef, expense);

    await createNotification(expense.recordedBy, {

        title: "Expense approved",

        message: `Your expense of KES ${expense.amount} (${expense.category}) has been approved and posted.`,

        type: "EXPENSE_POSTED",

    }).catch(() => {});

    return { expenseId, posted: true };

}


async function listExpenses(options = {}) {

    let query = db.collection(FINANCE_COLLECTIONS.EXPENSES);

    if (options.status) {

        query = query.where("status", "==", options.status);

    }

    if (options.category) {

        query = query.where("category", "==", options.category);

    }

    const snapshot = await query.get();

    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

}


module.exports = {

    createExpense,

    applyExpensePosting,

    listExpenses,

    VALID_CATEGORIES,

};
