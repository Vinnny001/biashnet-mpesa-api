const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    FINANCE_COLLECTIONS,
} = require("../config/financeCollections");


/*
=========================================================
BIASHNET FINANCE WALLET SERVICE
=========================================================

PURPOSE
---------------------------------------------------------

Generic wallet-by-owner for the Employees / HR / Payroll /
Expenses / Investor ledger / Loans domain.

This is a SEPARATE collection (financeWalletAccounts) from
the marketplace's own marketplaceWallets. It exists so the
live seller wallet system is never touched by this module.

One document per owner:

financeWalletAccounts/{ownerId}

ownerId is either:

- an employee UID
- an investor UID (referencing, never modifying, the
  existing investor/{uid} document)
- a lenderId
- the constant COMPANY_WALLET_ID ("company"), representing
  BIASHNET's own treasury for this ledger

WALLET MODEL

availableBalance
    Money the owner may withdraw (employees, investors).

totalContributions / contributionBalance
    Investor-only running totals.

withdrawalBalance
    Money locked while a finance withdrawal is processing.

totalWithdrawn
    Lifetime successful withdrawals.
=========================================================
*/


/* ========================================================
   MONEY
======================================================== */

function toMoney(value) {

    const amount = Number(value);

    if (!Number.isFinite(amount)) {

        throw new Error("Invalid wallet amount.");

    }

    return Number(amount.toFixed(2));

}


function validateAmount(amount, field = "Amount") {

    const value = toMoney(amount);

    if (value <= 0) {

        throw new Error(`${field} must be greater than zero.`);

    }

    return value;

}


/* ========================================================
   WALLET REFERENCE
======================================================== */

function getFinanceWalletRef(ownerId) {

    if (!ownerId) {

        throw new Error("Owner ID is required.");

    }

    return db
        .collection(FINANCE_COLLECTIONS.FINANCE_WALLET_ACCOUNTS)
        .doc(ownerId);

}


/* ========================================================
   DEFAULT WALLET
======================================================== */

function defaultFinanceWallet(ownerId, ownerType) {

    return {

        ownerId,

        ownerType: ownerType || "unknown",

        currency: "KES",

        availableBalance: 0,

        totalContributions: 0,

        contributionBalance: 0,

        withdrawalBalance: 0,

        totalWithdrawn: 0,

        createdAt: new Date(),

        updatedAt: new Date(),

    };

}


function normalizeFinanceWallet(wallet = {}) {

    return {

        ...wallet,

        availableBalance: toMoney(wallet.availableBalance || 0),

        totalContributions: toMoney(wallet.totalContributions || 0),

        contributionBalance: toMoney(wallet.contributionBalance || 0),

        withdrawalBalance: toMoney(wallet.withdrawalBalance || 0),

        totalWithdrawn: toMoney(wallet.totalWithdrawn || 0),

        currency: wallet.currency || "KES",

    };

}


/* ========================================================
   GET WALLET
======================================================== */

async function getFinanceWallet(ownerId) {

    const walletRef = getFinanceWalletRef(ownerId);

    const walletSnap = await walletRef.get();

    if (!walletSnap.exists) {

        return null;

    }

    return {

        id: walletSnap.id,

        ...normalizeFinanceWallet(walletSnap.data()),

    };

}


/* ========================================================
   CREATE WALLET IF NOT EXISTS
======================================================== */

async function createFinanceWalletIfNotExists(ownerId, ownerType) {

    const walletRef = getFinanceWalletRef(ownerId);

    const walletSnap = await walletRef.get();

    if (walletSnap.exists) {

        return {

            created: false,

            wallet: {

                id: walletSnap.id,

                ...normalizeFinanceWallet(walletSnap.data()),

            },

        };

    }

    const wallet = defaultFinanceWallet(ownerId, ownerType);

    await walletRef.set(wallet);

    return {

        created: true,

        wallet: {

            id: ownerId,

            ...wallet,

        },

    };

}


/* ========================================================
   CREDIT — TRANSACTION VERSION
========================================================

Increases availableBalance. When creditType is
"contribution", also increases totalContributions and
contributionBalance (investors only).
======================================================== */

function creditFinanceWalletInTransaction({

    transaction,

    ownerId,

    ownerType,

    amount,

    creditType = "balance",

}) {

    if (!transaction || typeof transaction.get !== "function") {

        throw new Error("Firestore transaction object is required.");

    }

    const creditAmount = validateAmount(amount, "Credit amount");

    const walletRef = getFinanceWalletRef(ownerId);

    return {

        walletRef,

        amount: creditAmount,

        read: async () => {

            const walletSnap = await transaction.get(walletRef);

            const wallet = walletSnap.exists
                ? normalizeFinanceWallet(walletSnap.data())
                : defaultFinanceWallet(ownerId, ownerType);

            const newAvailableBalance = toMoney(
                wallet.availableBalance + creditAmount
            );

            const updates = {

                availableBalance: newAvailableBalance,

                updatedAt: FieldValue.serverTimestamp(),

            };

            if (creditType === "contribution") {

                updates.totalContributions = toMoney(
                    wallet.totalContributions + creditAmount
                );

                updates.contributionBalance = toMoney(
                    wallet.contributionBalance + creditAmount
                );

            }

            if (walletSnap.exists) {

                transaction.update(walletRef, updates);

            } else {

                transaction.set(walletRef, {

                    ...wallet,

                    ...updates,

                });

            }

            return {

                ownerId,

                amount: creditAmount,

                newAvailableBalance,

                status: "CREDITED",

            };

        },

    };

}


async function creditFinanceWallet({

    ownerId,

    ownerType,

    amount,

    creditType = "balance",

}) {

    let result;

    await db.runTransaction(async (transaction) => {

        const operation = creditFinanceWalletInTransaction({

            transaction,

            ownerId,

            ownerType,

            amount,

            creditType,

        });

        result = await operation.read();

    });

    return { success: true, ...result };

}


/* ========================================================
   DEBIT — TRANSACTION VERSION
========================================================

Decreases availableBalance. Throws if funds are
insufficient.
======================================================== */

function debitFinanceWalletInTransaction({

    transaction,

    ownerId,

    ownerType,

    amount,

}) {

    if (!transaction || typeof transaction.get !== "function") {

        throw new Error("Firestore transaction object is required.");

    }

    const debitAmount = validateAmount(amount, "Debit amount");

    const walletRef = getFinanceWalletRef(ownerId);

    return {

        walletRef,

        amount: debitAmount,

        read: async () => {

            const walletSnap = await transaction.get(walletRef);

            const wallet = walletSnap.exists
                ? normalizeFinanceWallet(walletSnap.data())
                : defaultFinanceWallet(ownerId, ownerType);

            if (wallet.availableBalance < debitAmount) {

                throw new Error(

                    `Insufficient finance wallet balance. ` +
                    `Available: KES ${wallet.availableBalance}. ` +
                    `Required: KES ${debitAmount}.`

                );

            }

            const newAvailableBalance = toMoney(
                wallet.availableBalance - debitAmount
            );

            const updates = {

                availableBalance: newAvailableBalance,

                updatedAt: FieldValue.serverTimestamp(),

            };

            if (walletSnap.exists) {

                transaction.update(walletRef, updates);

            } else {

                transaction.set(walletRef, {

                    ...wallet,

                    ...updates,

                });

            }

            return {

                ownerId,

                amount: debitAmount,

                newAvailableBalance,

                status: "DEBITED",

            };

        },

    };

}


async function debitFinanceWallet({

    ownerId,

    ownerType,

    amount,

}) {

    let result;

    await db.runTransaction(async (transaction) => {

        const operation = debitFinanceWalletInTransaction({

            transaction,

            ownerId,

            ownerType,

            amount,

        });

        result = await operation.read();

    });

    return { success: true, ...result };

}


/* ========================================================
   LOCK WITHDRAWAL — TRANSACTION VERSION
======================================================== */

function lockFinanceWithdrawalInTransaction({

    transaction,

    ownerId,

    amount,

    withdrawalId,

}) {

    if (!transaction || typeof transaction.get !== "function") {

        throw new Error("Firestore transaction object is required.");

    }

    const withdrawalAmount = validateAmount(amount, "Withdrawal amount");

    if (!withdrawalId) {

        throw new Error("Withdrawal ID is required.");

    }

    const walletRef = getFinanceWalletRef(ownerId);

    return {

        walletRef,

        amount: withdrawalAmount,

        read: async () => {

            const walletSnap = await transaction.get(walletRef);

            if (!walletSnap.exists) {

                throw new Error("Finance wallet does not exist.");

            }

            const wallet = normalizeFinanceWallet(walletSnap.data());

            if (wallet.availableBalance < withdrawalAmount) {

                throw new Error(

                    `Insufficient available balance. ` +
                    `Available: KES ${wallet.availableBalance}. ` +
                    `Requested: KES ${withdrawalAmount}.`

                );

            }

            const newAvailableBalance = toMoney(
                wallet.availableBalance - withdrawalAmount
            );

            const newWithdrawalBalance = toMoney(
                wallet.withdrawalBalance + withdrawalAmount
            );

            transaction.update(walletRef, {

                availableBalance: newAvailableBalance,

                withdrawalBalance: newWithdrawalBalance,

                updatedAt: FieldValue.serverTimestamp(),

            });

            return {

                ownerId,

                withdrawalId,

                amount: withdrawalAmount,

                availableBalance: newAvailableBalance,

                withdrawalBalance: newWithdrawalBalance,

                status: "LOCKED",

            };

        },

    };

}


async function lockFinanceWithdrawal({ ownerId, amount, withdrawalId }) {

    let result;

    await db.runTransaction(async (transaction) => {

        const operation = lockFinanceWithdrawalInTransaction({

            transaction,

            ownerId,

            amount,

            withdrawalId,

        });

        result = await operation.read();

    });

    return { success: true, ...result };

}


/* ========================================================
   COMPLETE WITHDRAWAL
======================================================== */

async function completeFinanceWithdrawal({ ownerId, amount, withdrawalId }) {

    const withdrawalAmount = validateAmount(amount, "Withdrawal amount");

    if (!withdrawalId) {

        throw new Error("Withdrawal ID is required.");

    }

    const walletRef = getFinanceWalletRef(ownerId);

    let result;

    await db.runTransaction(async (transaction) => {

        const walletSnap = await transaction.get(walletRef);

        if (!walletSnap.exists) {

            throw new Error("Finance wallet does not exist.");

        }

        const wallet = normalizeFinanceWallet(walletSnap.data());

        if (wallet.withdrawalBalance < withdrawalAmount) {

            throw new Error("Withdrawal balance is insufficient.");

        }

        const newWithdrawalBalance = toMoney(
            wallet.withdrawalBalance - withdrawalAmount
        );

        const newTotalWithdrawn = toMoney(
            wallet.totalWithdrawn + withdrawalAmount
        );

        transaction.update(walletRef, {

            withdrawalBalance: newWithdrawalBalance,

            totalWithdrawn: newTotalWithdrawn,

            updatedAt: FieldValue.serverTimestamp(),

        });

        result = {

            ownerId,

            withdrawalId,

            amount: withdrawalAmount,

            withdrawalBalance: newWithdrawalBalance,

            totalWithdrawn: newTotalWithdrawn,

            status: "COMPLETED",

        };

    });

    return { success: true, ...result };

}


/* ========================================================
   RESTORE FAILED WITHDRAWAL
======================================================== */

async function restoreFailedFinanceWithdrawal({ ownerId, amount, withdrawalId }) {

    const withdrawalAmount = validateAmount(amount, "Withdrawal amount");

    if (!withdrawalId) {

        throw new Error("Withdrawal ID is required.");

    }

    const walletRef = getFinanceWalletRef(ownerId);

    let result;

    await db.runTransaction(async (transaction) => {

        const walletSnap = await transaction.get(walletRef);

        if (!walletSnap.exists) {

            throw new Error("Finance wallet does not exist.");

        }

        const wallet = normalizeFinanceWallet(walletSnap.data());

        if (wallet.withdrawalBalance < withdrawalAmount) {

            throw new Error("Withdrawal balance is insufficient.");

        }

        const newWithdrawalBalance = toMoney(
            wallet.withdrawalBalance - withdrawalAmount
        );

        const newAvailableBalance = toMoney(
            wallet.availableBalance + withdrawalAmount
        );

        transaction.update(walletRef, {

            withdrawalBalance: newWithdrawalBalance,

            availableBalance: newAvailableBalance,

            updatedAt: FieldValue.serverTimestamp(),

        });

        result = {

            ownerId,

            withdrawalId,

            amount: withdrawalAmount,

            withdrawalBalance: newWithdrawalBalance,

            availableBalance: newAvailableBalance,

            status: "RESTORED",

        };

    });

    return { success: true, ...result };

}


module.exports = {

    getFinanceWallet,

    createFinanceWalletIfNotExists,

    creditFinanceWallet,

    creditFinanceWalletInTransaction,

    debitFinanceWallet,

    debitFinanceWalletInTransaction,

    lockFinanceWithdrawal,

    lockFinanceWithdrawalInTransaction,

    completeFinanceWithdrawal,

    restoreFailedFinanceWithdrawal,

    toMoney,

    validateAmount,

};
