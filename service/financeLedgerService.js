const {
    db,
} = require("../config/firebase");

const {
    FINANCE_COLLECTIONS,
} = require("../config/financeCollections");

const {
    FINANCE_TRANSACTION_STATUS,
} = require("../config/financeConstants");


/*
=========================================================
BIASHNET FINANCE LEDGER SERVICE
=========================================================

PURPOSE
---------------------------------------------------------

Immutable ledger for the Employees / HR / Payroll /
Expenses / Investor ledger / Loans domain, modeled on the
transactionRecords spec:

{
  transactionId, transactionType, amount, currency,
  direction, fromId, fromType, toId, toType, method,
  status, reference, description, metadata,
  createdAt, updatedAt
}

This is a SEPARATE collection (financeTransactionRecords)
from the marketplace's marketplaceTransactions ledger.
=========================================================
*/


/* ========================================================
   MONEY
======================================================== */

function toMoney(value) {

    const amount = Number(value);

    if (!Number.isFinite(amount)) {

        throw new Error("Invalid monetary value.");

    }

    return Number(amount.toFixed(2));

}


function requireValue(value, field) {

    if (value === undefined || value === null || value === "") {

        throw new Error(`${field} is required.`);

    }

}


/* ========================================================
   BUILD LEDGER ROW
======================================================== */

function buildFinanceTransactionData({

    transactionId,

    transactionType,

    amount,

    currency = "KES",

    direction,

    fromId = null,

    fromType = null,

    toId = null,

    toType = null,

    method = "wallet",

    status = FINANCE_TRANSACTION_STATUS.COMPLETED,

    reference = null,

    description = "",

    metadata = {},

}) {

    requireValue(transactionType, "Transaction type");

    requireValue(direction, "Direction");

    const transactionAmount = toMoney(amount);

    if (transactionAmount <= 0) {

        throw new Error("Transaction amount must be greater than zero.");

    }

    return {

        transactionId,

        transactionType,

        amount: transactionAmount,

        currency,

        direction,

        fromId,

        fromType,

        toId,

        toType,

        method,

        status,

        reference,

        description,

        metadata: metadata && typeof metadata === "object" ? metadata : {},

        createdAt: new Date(),

        updatedAt: new Date(),

    };

}


/* ========================================================
   CREATE — STANDALONE
======================================================== */

async function createFinanceTransaction(options) {

    requireValue(options.transactionId, "Transaction ID");

    const transactionRef = db
        .collection(FINANCE_COLLECTIONS.FINANCE_TRANSACTION_RECORDS)
        .doc(options.transactionId);

    const existing = await transactionRef.get();

    if (existing.exists) {

        return {

            success: true,

            alreadyExists: true,

            transactionId: options.transactionId,

            transaction: { id: existing.id, ...existing.data() },

        };

    }

    const transactionData = buildFinanceTransactionData(options);

    await transactionRef.create(transactionData);

    console.log(
        "💰 FINANCE TRANSACTION CREATED:",
        options.transactionId,
        transactionData.transactionType,
        transactionData.amount
    );

    return {

        success: true,

        alreadyExists: false,

        transactionId: options.transactionId,

        transaction: transactionData,

    };

}


/* ========================================================
   CREATE — INSIDE FIRESTORE TRANSACTION
======================================================== */

function createFinanceTransactionInTransaction({ transaction, ...options }) {

    if (!transaction || typeof transaction.set !== "function") {

        throw new Error("Firestore transaction object is required.");

    }

    requireValue(options.transactionId, "Transaction ID");

    const transactionRef = db
        .collection(FINANCE_COLLECTIONS.FINANCE_TRANSACTION_RECORDS)
        .doc(options.transactionId);

    const transactionData = buildFinanceTransactionData(options);

    transaction.set(transactionRef, transactionData, { merge: false });

    return { transactionId: options.transactionId, transactionRef, transaction: transactionData };

}


/* ========================================================
   QUERIES
======================================================== */

async function getFinanceTransaction(transactionId) {

    requireValue(transactionId, "Transaction ID");

    const snap = await db
        .collection(FINANCE_COLLECTIONS.FINANCE_TRANSACTION_RECORDS)
        .doc(transactionId)
        .get();

    if (!snap.exists) {

        return null;

    }

    return { id: snap.id, ...snap.data() };

}


async function getFinanceLedgerForOwner(ownerId, options = {}) {

    requireValue(ownerId, "Owner ID");

    let limit = Number(options.limit || 200);

    if (!Number.isInteger(limit) || limit <= 0) {

        limit = 200;

    }

    if (limit > 500) {

        limit = 500;

    }

    const [fromSnap, toSnap] = await Promise.all([

        db
            .collection(FINANCE_COLLECTIONS.FINANCE_TRANSACTION_RECORDS)
            .where("fromId", "==", ownerId)
            .limit(limit)
            .get(),

        db
            .collection(FINANCE_COLLECTIONS.FINANCE_TRANSACTION_RECORDS)
            .where("toId", "==", ownerId)
            .limit(limit)
            .get(),

    ]);

    const rows = new Map();

    [...fromSnap.docs, ...toSnap.docs].forEach((document) => {

        rows.set(document.id, { id: document.id, ...document.data() });

    });

    const transactions = Array.from(rows.values());

    transactions.sort((a, b) => {

        const aTime = a.createdAt?.toMillis
            ? a.createdAt.toMillis()
            : new Date(a.createdAt || 0).getTime();

        const bTime = b.createdAt?.toMillis
            ? b.createdAt.toMillis()
            : new Date(b.createdAt || 0).getTime();

        return bTime - aTime;

    });

    return transactions;

}


module.exports = {

    createFinanceTransaction,

    createFinanceTransactionInTransaction,

    getFinanceTransaction,

    getFinanceLedgerForOwner,

    toMoney,

};
