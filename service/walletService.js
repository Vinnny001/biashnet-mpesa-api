const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");


/*
=========================================================
BIASHNET WALLET SERVICE
=========================================================

PURPOSE
---------------------------------------------------------

Controls seller wallet balances.

WALLET MODEL

availableBalance
    =
Money seller can withdraw.

pendingBalance
    =
Money earned from successfully paid orders but still
held until delivery/completion-code verification.

withdrawalBalance
    =
Money locked while an M-Pesa withdrawal is processing.

totalEarned
    =
Lifetime seller funds released into availableBalance.

totalWithdrawn
    =
Lifetime successfully withdrawn amount.


MONEY FLOW

BUYER PAYS
    ↓
Seller NET
    ↓
pendingBalance
    ↓
Buyer completion code verified
    ↓
Settlement Service
    ↓
availableBalance
    ↓
Withdrawal Service
    ↓
withdrawalBalance
    ↓
M-Pesa B2C
    ↓
totalWithdrawn


IMPORTANT

This service does NOT:

- initiate M-Pesa
- process STK Push
- process Daraja callbacks
- calculate commission
- verify completion codes
- decide whether an order is completed
- create marketplace orders

It only manages wallet balances.


TRANSACTION DESIGN

There are two classes of methods:

1. Standalone wallet methods
   Start their own Firestore transaction.

2. Transaction-aware methods
   Use an existing Firestore transaction.

The transaction-aware methods are required by:

paymentService
settlementService
withdrawalService

so that:

wallet
+
order
+
ledger

can commit atomically.

=========================================================
*/


/* ========================================================
   MONEY
======================================================== */

function toMoney(value) {

    const amount =
        Number(value);

    if (
        !Number.isFinite(amount)
    ) {

        throw new Error(
            "Invalid wallet amount."
        );

    }

    return Number(
        amount.toFixed(2)
    );

}


/* ========================================================
   POSITIVE AMOUNT
======================================================== */

function validateAmount(
    amount,
    field = "Amount"
) {

    const value =
        toMoney(amount);

    if (
        value <= 0
    ) {

        throw new Error(
            `${field} must be greater than zero.`
        );

    }

    return value;

}


/* ========================================================
   WALLET REFERENCE
======================================================== */

function getWalletRef(
    userId
) {

    if (!userId) {

        throw new Error(
            "User ID is required."
        );

    }

    return db
        .collection(
            COLLECTIONS.WALLETS
        )
        .doc(
            userId
        );

}


/* ========================================================
   DEFAULT WALLET
======================================================== */

function defaultWallet(
    userId
) {

    return {

        userId,

        currency:
            "KES",

        availableBalance:
            0,

        pendingBalance:
            0,

        withdrawalBalance:
            0,

        totalEarned:
            0,

        totalWithdrawn:
            0,

        createdAt:
            new Date(),

        updatedAt:
            new Date(),

    };

}


/* ========================================================
   NORMALIZE WALLET
========================================================

Supports old wallets that may still contain:

heldBalance

We migrate that value into:

pendingBalance
======================================================== */

function normalizeWalletData(
    wallet = {}
) {

    const pendingBalance =
        wallet.pendingBalance !== undefined
            ? wallet.pendingBalance
            : wallet.heldBalance || 0;

    return {

        ...wallet,

        availableBalance:
            toMoney(
                wallet.availableBalance || 0
            ),

        pendingBalance:
            toMoney(
                pendingBalance
            ),

        withdrawalBalance:
            toMoney(
                wallet.withdrawalBalance || 0
            ),

        totalEarned:
            toMoney(
                wallet.totalEarned || 0
            ),

        totalWithdrawn:
            toMoney(
                wallet.totalWithdrawn || 0
            ),

        currency:
            wallet.currency || "KES",

    };

}


/* ========================================================
   GET WALLET
======================================================== */

async function getWallet(
    userId
) {

    const walletRef =
        getWalletRef(
            userId
        );

    const walletSnap =
        await walletRef.get();

    if (
        !walletSnap.exists
    ) {

        return null;

    }

    return {

        id:
            walletSnap.id,

        ...normalizeWalletData(
            walletSnap.data()
        ),

    };

}


/* ========================================================
   CREATE WALLET
======================================================== */

async function createWalletIfNotExists(
    userId
) {

    const walletRef =
        getWalletRef(
            userId
        );

    const walletSnap =
        await walletRef.get();

    if (
        walletSnap.exists
    ) {

        const existing =
            normalizeWalletData(
                walletSnap.data()
            );

        /*
        Migrate old heldBalance wallets.
        */

        const updates = {

            pendingBalance:
                existing.pendingBalance,

            updatedAt:
                FieldValue.serverTimestamp(),

        };

        if (
            existing.heldBalance !== undefined
        ) {

            updates.heldBalance =
                FieldValue.delete();

        }

        await walletRef.update(
            updates
        );

        return {

            created: false,

            wallet: {

                id:
                    walletSnap.id,

                ...existing,

                pendingBalance:
                    existing.pendingBalance,

            },

        };

    }


    const wallet =
        defaultWallet(
            userId
        );


    await walletRef.create(
        wallet
    );


    return {

        created: true,

        wallet: {

            id:
                userId,

            ...wallet,

        },

    };

}


/* ========================================================
   HOLD SELLER FUNDS — TRANSACTION VERSION
========================================================

Called by paymentService.

Example:

Sale             = KES 1,000
Commission       = KES 50
Seller net       = KES 950

After payment:

pendingBalance
    OLD 0
    +950
    ----
    950

availableBalance remains unchanged.
======================================================== */

function holdSellerFundsInTransaction({

    transaction,

    sellerId,

    amount,

    orderId,

    paymentId,

}) {

    if (
        !transaction ||
        typeof transaction.get !== "function"
    ) {

        throw new Error(
            "Firestore transaction object is required."
        );

    }

    const heldAmount =
        validateAmount(
            amount,
            "Seller held amount"
        );


    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!paymentId) {

        throw new Error(
            "Payment ID is required."
        );

    }


    const walletRef =
        getWalletRef(
            sellerId
        );


    return {

        walletRef,

        amount:
            heldAmount,

        read: async () => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            const wallet =
                walletSnap.exists
                    ? normalizeWalletData(
                        walletSnap.data()
                    )
                    : defaultWallet(
                        sellerId
                    );


            const newPending =
                toMoney(
                    wallet.pendingBalance +
                    heldAmount
                );


            if (
                walletSnap.exists
            ) {

                transaction.update(

                    walletRef,

                    {

                        pendingBalance:
                            newPending,

                        updatedAt:
                            FieldValue.serverTimestamp(),

                    }

                );

            } else {

                transaction.set(

                    walletRef,

                    {

                        ...wallet,

                        pendingBalance:
                            newPending,

                        updatedAt:
                            FieldValue.serverTimestamp(),

                    }

                );

            }


            return {

                sellerId,

                orderId,

                paymentId,

                amount:
                    heldAmount,

                oldPendingBalance:
                    wallet.pendingBalance,

                newPendingBalance:
                    newPending,

                status:
                    "HELD",

            };

        },

    };

}


/* ========================================================
   HOLD SELLER FUNDS — STANDALONE
======================================================== */

async function holdSellerFunds({

    sellerId,

    amount,

    orderId,

    paymentId,

}) {

    let result;

    await db.runTransaction(
        async transaction => {

            const operation =
                holdSellerFundsInTransaction({

                    transaction,

                    sellerId,

                    amount,

                    orderId,

                    paymentId,

                });


            result =
                await operation.read();

        }
    );


    console.log(
        "🔒 SELLER FUNDS HELD:",
        result
    );


    return {

        success: true,

        ...result,

    };

}


/* ========================================================
   RELEASE SELLER FUNDS — TRANSACTION VERSION
========================================================

Called by settlementService.

pendingBalance
       ↓
availableBalance
======================================================== */

function releaseHeldFundsInTransaction({

    transaction,

    sellerId,

    amount,

    orderId,

    paymentId,

}) {

    if (
        !transaction ||
        typeof transaction.get !== "function"
    ) {

        throw new Error(
            "Firestore transaction object is required."
        );

    }


    const releaseAmount =
        validateAmount(
            amount,
            "Release amount"
        );


    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const walletRef =
        getWalletRef(
            sellerId
        );


    return {

        walletRef,

        amount:
            releaseAmount,

        read: async () => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet does not exist."
                );

            }


            const wallet =
                normalizeWalletData(
                    walletSnap.data()
                );


            if (
                wallet.pendingBalance <
                releaseAmount
            ) {

                throw new Error(

                    `Insufficient pending seller balance. ` +
                    `Available pending: KES ${wallet.pendingBalance}. ` +
                    `Required: KES ${releaseAmount}.`

                );

            }


            const newPendingBalance =
                toMoney(
                    wallet.pendingBalance -
                    releaseAmount
                );


            const newAvailableBalance =
                toMoney(
                    wallet.availableBalance +
                    releaseAmount
                );


            const newTotalEarned =
                toMoney(
                    wallet.totalEarned +
                    releaseAmount
                );


            transaction.update(

                walletRef,

                {

                    pendingBalance:
                        newPendingBalance,

                    availableBalance:
                        newAvailableBalance,

                    totalEarned:
                        newTotalEarned,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }

            );


            return {

                sellerId,

                orderId,

                paymentId:
                    paymentId || null,

                amount:
                    releaseAmount,

                oldPendingBalance:
                    wallet.pendingBalance,

                newPendingBalance,

                oldAvailableBalance:
                    wallet.availableBalance,

                newAvailableBalance,

                newTotalEarned,

                status:
                    "RELEASED",

            };

        },

    };

}


/* ========================================================
   RELEASE SELLER FUNDS — STANDALONE
======================================================== */

async function releaseHeldFunds({

    sellerId,

    amount,

    orderId,

    paymentId,

}) {

    let result;

    await db.runTransaction(
        async transaction => {

            const operation =
                releaseHeldFundsInTransaction({

                    transaction,

                    sellerId,

                    amount,

                    orderId,

                    paymentId,

                });


            result =
                await operation.read();

        }
    );


    console.log(
        "🔓 SELLER FUNDS RELEASED:",
        result
    );


    return {

        success: true,

        ...result,

    };

}


/* ========================================================
   LOCK WITHDRAWAL — TRANSACTION VERSION
========================================================

availableBalance
        ↓
withdrawalBalance
======================================================== */

function lockWithdrawalFundsInTransaction({

    transaction,

    sellerId,

    amount,

    withdrawalId,

}) {

    if (
        !transaction ||
        typeof transaction.get !== "function"
    ) {

        throw new Error(
            "Firestore transaction object is required."
        );

    }


    const withdrawalAmount =
        validateAmount(
            amount,
            "Withdrawal amount"
        );


    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const walletRef =
        getWalletRef(
            sellerId
        );


    return {

        walletRef,

        amount:
            withdrawalAmount,

        read: async () => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet does not exist."
                );

            }


            const wallet =
                normalizeWalletData(
                    walletSnap.data()
                );


            if (
                wallet.availableBalance <
                withdrawalAmount
            ) {

                throw new Error(

                    `Insufficient available balance. ` +
                    `Available: KES ${wallet.availableBalance}. ` +
                    `Requested: KES ${withdrawalAmount}.`

                );

            }


            const newAvailableBalance =
                toMoney(
                    wallet.availableBalance -
                    withdrawalAmount
                );


            const newWithdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance +
                    withdrawalAmount
                );


            transaction.update(

                walletRef,

                {

                    availableBalance:
                        newAvailableBalance,

                    withdrawalBalance:
                        newWithdrawalBalance,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }

            );


            return {

                sellerId,

                withdrawalId,

                amount:
                    withdrawalAmount,

                availableBalance:
                    newAvailableBalance,

                withdrawalBalance:
                    newWithdrawalBalance,

                status:
                    "LOCKED",

            };

        },

    };

}


/* ========================================================
   LOCK WITHDRAWAL — STANDALONE
======================================================== */

async function lockWithdrawalFunds({

    sellerId,

    amount,

    withdrawalId,

}) {

    let result;

    await db.runTransaction(
        async transaction => {

            const operation =
                lockWithdrawalFundsInTransaction({

                    transaction,

                    sellerId,

                    amount,

                    withdrawalId,

                });


            result =
                await operation.read();

        }
    );


    return {

        success: true,

        ...result,

    };

}


/* ========================================================
   COMPLETE WITHDRAWAL — TRANSACTION VERSION
======================================================== */

function completeWithdrawalInTransaction({

    transaction,

    sellerId,

    amount,

    withdrawalId,

}) {

    const withdrawalAmount =
        validateAmount(
            amount,
            "Withdrawal amount"
        );


    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const walletRef =
        getWalletRef(
            sellerId
        );


    return {

        walletRef,

        amount:
            withdrawalAmount,

        read: async () => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet does not exist."
                );

            }


            const wallet =
                normalizeWalletData(
                    walletSnap.data()
                );


            if (
                wallet.withdrawalBalance <
                withdrawalAmount
            ) {

                throw new Error(
                    "Withdrawal balance is insufficient."
                );

            }


            const newWithdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance -
                    withdrawalAmount
                );


            const newTotalWithdrawn =
                toMoney(
                    wallet.totalWithdrawn +
                    withdrawalAmount
                );


            transaction.update(

                walletRef,

                {

                    withdrawalBalance:
                        newWithdrawalBalance,

                    totalWithdrawn:
                        newTotalWithdrawn,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }

            );


            return {

                sellerId,

                withdrawalId,

                amount:
                    withdrawalAmount,

                withdrawalBalance:
                    newWithdrawalBalance,

                totalWithdrawn:
                    newTotalWithdrawn,

                status:
                    "COMPLETED",

            };

        },

    };

}


/* ========================================================
   COMPLETE WITHDRAWAL — STANDALONE
======================================================== */

async function completeWithdrawal({

    sellerId,

    amount,

    withdrawalId,

}) {

    let result;

    await db.runTransaction(
        async transaction => {

            const operation =
                completeWithdrawalInTransaction({

                    transaction,

                    sellerId,

                    amount,

                    withdrawalId,

                });


            result =
                await operation.read();

        }
    );


    return {

        success: true,

        ...result,

    };

}


/* ========================================================
   RESTORE FAILED WITHDRAWAL
======================================================== */

function restoreFailedWithdrawalInTransaction({

    transaction,

    sellerId,

    amount,

    withdrawalId,

}) {

    const withdrawalAmount =
        validateAmount(
            amount,
            "Withdrawal amount"
        );


    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const walletRef =
        getWalletRef(
            sellerId
        );


    return {

        walletRef,

        amount:
            withdrawalAmount,

        read: async () => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet does not exist."
                );

            }


            const wallet =
                normalizeWalletData(
                    walletSnap.data()
                );


            if (
                wallet.withdrawalBalance <
                withdrawalAmount
            ) {

                throw new Error(
                    "Withdrawal balance is insufficient."
                );

            }


            const newWithdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance -
                    withdrawalAmount
                );


            const newAvailableBalance =
                toMoney(
                    wallet.availableBalance +
                    withdrawalAmount
                );


            transaction.update(

                walletRef,

                {

                    withdrawalBalance:
                        newWithdrawalBalance,

                    availableBalance:
                        newAvailableBalance,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }

            );


            return {

                sellerId,

                withdrawalId,

                amount:
                    withdrawalAmount,

                withdrawalBalance:
                    newWithdrawalBalance,

                availableBalance:
                    newAvailableBalance,

                status:
                    "RESTORED",

            };

        },

    };

}


/* ========================================================
   RESTORE FAILED WITHDRAWAL — STANDALONE
======================================================== */

async function restoreFailedWithdrawal({

    sellerId,

    amount,

    withdrawalId,

}) {

    let result;

    await db.runTransaction(
        async transaction => {

            const operation =
                restoreFailedWithdrawalInTransaction({

                    transaction,

                    sellerId,

                    amount,

                    withdrawalId,

                });


            result =
                await operation.read();

        }
    );


    return {

        success: true,

        ...result,

    };

}


/* ========================================================
   GET AVAILABLE BALANCE
======================================================== */

async function getAvailableBalance(
    sellerId
) {

    const wallet =
        await getWallet(
            sellerId
        );


    if (!wallet) {

        return 0;

    }


    return toMoney(
        wallet.availableBalance
    );

}


/* ========================================================
   GET PENDING BALANCE
======================================================== */

async function getPendingBalance(
    sellerId
) {

    const wallet =
        await getWallet(
            sellerId
        );


    if (!wallet) {

        return 0;

    }


    return toMoney(
        wallet.pendingBalance
    );

}


/* ========================================================
   GET SELLER WALLET SUMMARY
======================================================== */

async function getWalletSummary(
    sellerId
) {

    const wallet =
        await getWallet(
            sellerId
        );


    if (!wallet) {

        return {

            exists: false,

            userId:
                sellerId,

            currency:
                "KES",

            availableBalance:
                0,

            pendingBalance:
                0,

            withdrawalBalance:
                0,

            totalEarned:
                0,

            totalWithdrawn:
                0,

        };

    }


    return {

        exists: true,

        userId:
            sellerId,

        currency:
            wallet.currency,

        availableBalance:
            wallet.availableBalance,

        pendingBalance:
            wallet.pendingBalance,

        withdrawalBalance:
            wallet.withdrawalBalance,

        totalEarned:
            wallet.totalEarned,

        totalWithdrawn:
            wallet.totalWithdrawn,

    };

}


/* ========================================================
   EXPORTS
======================================================== */

module.exports = {

    /*
    References / reads
    */

    getWallet,
    createWalletIfNotExists,
    getAvailableBalance,
    getPendingBalance,
    getWalletSummary,

    /*
    Payment / escrow
    */

    holdSellerFunds,
    holdSellerFundsInTransaction,

    /*
    Settlement
    */

    releaseHeldFunds,
    releaseHeldFundsInTransaction,

    /*
    Withdrawals
    */

    lockWithdrawalFunds,
    lockWithdrawalFundsInTransaction,

    completeWithdrawal,
    completeWithdrawalInTransaction,

    restoreFailedWithdrawal,
    restoreFailedWithdrawalInTransaction,

    /*
    Money
    */

    toMoney,
    validateAmount,

};