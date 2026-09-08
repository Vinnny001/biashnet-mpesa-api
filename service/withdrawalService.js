const {
    db,
    FieldValue,
} = require("../config/firebase");


const {
    COLLECTIONS,
} = require("../config/collections");


const {
    PAYOUT_STATUS,
    TRANSACTION_TYPES,
    PAYMENT_STATUS,
    PAYMENT_METHODS,
    PAYMENT_PROVIDERS,
    MIN_WITHDRAWAL_AMOUNT,
} = require("../config/paymentConstants");


const {
    generateWithdrawalId,
    generateTransactionId,
} = require("../utils/codeGenerator");


/*
=========================================================
BIASHNET WITHDRAWAL SERVICE
=========================================================

SELLER MONEY FLOW

ORDER PAYMENT
      ↓
sellerNet
      ↓
seller.pendingBalance
      ↓
ORDER COMPLETED
      ↓
SETTLEMENT SERVICE
      ↓
seller.availableBalance
      ↓
CREATE WITHDRAWAL
      ↓
availableBalance decreases
withdrawalBalance increases
      ↓
B2C REQUEST
      ↓
PROCESSING
      ↓
     ┌───────────────┐
     │               │
   SUCCESS         FAILURE
     │               │
     ↓               ↓
withdrawalBalance   withdrawalBalance
decreases           decreases
                     +
                  availableBalance
                  restored

IMPORTANT

This service:

- does NOT calculate commission
- does NOT settle marketplace orders
- does NOT verify completion codes
- does NOT initiate STK Push
- does NOT receive M-Pesa callbacks directly

The B2C provider/controller calls:

markWithdrawalProcessing()
completeWithdrawal()
failWithdrawal()

=========================================================
CANONICAL WALLET FIELDS
=========================================================

availableBalance
    Money seller may withdraw.

pendingBalance
    Money from paid marketplace orders awaiting settlement.

withdrawalBalance
    Money currently locked in active withdrawals.

totalEarned
    Lifetime seller funds released through settlement.

totalWithdrawn
    Lifetime successful withdrawals.

=========================================================
*/


/*
=========================================================
MONEY
=========================================================
*/

function toMoney(value) {

    const amount =
        Number(value);

    if (!Number.isFinite(amount)) {

        throw new Error(
            "Invalid monetary value."
        );

    }

    return Number(
        amount.toFixed(2)
    );

}


/*
=========================================================
NORMALIZE PHONE
=========================================================

Supports:

0712345678
0112345678

254712345678
254112345678

+254712345678
+254112345678

712345678
112345678

=========================================================
*/

function normalizePhone(phone) {

    let value =
        String(phone || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "");


    if (
        value.startsWith("+254")
    ) {

        value =
            value.substring(1);

    }


    if (
        /^(07|01)\d{8}$/.test(value)
    ) {

        value =
            "254" +
            value.substring(1);

    }


    if (
        /^[17]\d{8}$/.test(value)
    ) {

        value =
            "254" +
            value;

    }


    return value;

}


/*
=========================================================
VALIDATE PHONE
=========================================================

Supports Kenyan 07 and 01 mobile numbers.

=========================================================
*/

function validatePhone(phone) {

    return /^254[17]\d{8}$/.test(
        phone
    );

}


/*
=========================================================
VALIDATE AMOUNT
=========================================================
*/

function validateAmount(amount) {

    const value =
        toMoney(amount);

    if (
        value <= 0
    ) {

        throw new Error(
            "Withdrawal amount must be greater than zero."
        );

    }

    return value;

}


/*
=========================================================
WALLET REFERENCE
=========================================================
*/

function getWalletRef(userId) {

    if (!userId) {

        throw new Error(
            "Seller ID is required."
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


/*
=========================================================
WITHDRAWAL REFERENCE
=========================================================
*/

function getWithdrawalRef(withdrawalId) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }

    return db
        .collection(
            COLLECTIONS.WITHDRAWALS
        )
        .doc(
            withdrawalId
        );

}


/*
=========================================================
TRANSACTION REFERENCE
=========================================================
*/

function getTransactionRef(
    transactionId
) {

    if (!transactionId) {

        throw new Error(
            "Transaction ID is required."
        );

    }

    return db
        .collection(
            COLLECTIONS.TRANSACTIONS
        )
        .doc(
            transactionId
        );

}


/*
=========================================================
CREATE WITHDRAWAL
=========================================================

This is the first financial step.

AVAILABLE
    ↓
WITHDRAWAL LOCK

Atomic operations:

1. Read seller wallet
2. Verify available balance
3. Deduct availableBalance
4. Increase withdrawalBalance
5. Create withdrawal
6. Create withdrawal ledger

=========================================================
*/

async function createWithdrawal({

    userId,

    amount,

    phoneNumber,

}) {

    /*
    =====================================================
    1. BASIC VALIDATION
    =====================================================
    */

    if (!userId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const withdrawalAmount =
        validateAmount(
            amount
        );


    if (
        withdrawalAmount <
        MIN_WITHDRAWAL_AMOUNT
    ) {

        throw new Error(
            `Minimum withdrawal amount is KES ${MIN_WITHDRAWAL_AMOUNT}.`
        );

    }


    /*
    =====================================================
    2. PHONE
    =====================================================
    */

    const phone =
        normalizePhone(
            phoneNumber
        );


    if (
        !validatePhone(phone)
    ) {

        throw new Error(
            "Enter a valid Kenyan M-Pesa number, e.g. 0712345678 or 0112345678."
        );

    }


    /*
    =====================================================
    3. IDs
    =====================================================
    */

    const withdrawalId =
        generateWithdrawalId();


    /*
    Deterministic ledger ID.

    One withdrawal request
    =
    One withdrawal ledger.
    */

    const transactionId =
        `WITHDRAWAL_${withdrawalId}`;


    const walletRef =
        getWalletRef(
            userId
        );


    const withdrawalRef =
        getWithdrawalRef(
            withdrawalId
        );


    const transactionRef =
        getTransactionRef(
            transactionId
        );


    /*
    =====================================================
    4. ATOMIC TRANSACTION
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            ------------------------------------------------
            READ WALLET
            ------------------------------------------------
            */

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet not found."
                );

            }


            const wallet =
                walletSnap.data();


            /*
            ------------------------------------------------
            CANONICAL BALANCES
            ------------------------------------------------
            */

            const availableBalance =
                toMoney(
                    wallet.availableBalance
                );


            const withdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance
                );


            const pendingBalance =
                toMoney(
                    wallet.pendingBalance
                );


            /*
            ------------------------------------------------
            VERIFY AVAILABLE BALANCE
            ------------------------------------------------
            */

            if (
                availableBalance <
                withdrawalAmount
            ) {

                throw new Error(

                    `Insufficient available balance. ` +
                    `Available: KES ${availableBalance}. ` +
                    `Requested: KES ${withdrawalAmount}.`

                );

            }


            /*
            ------------------------------------------------
            NEW BALANCES
            ------------------------------------------------
            */

            const newAvailableBalance =
                toMoney(
                    availableBalance -
                    withdrawalAmount
                );


            const newWithdrawalBalance =
                toMoney(
                    withdrawalBalance +
                    withdrawalAmount
                );


            /*
            ------------------------------------------------
            SAFETY CHECK
            ------------------------------------------------
            */

            if (
                newAvailableBalance < 0
            ) {

                throw new Error(
                    "Withdrawal would create a negative wallet balance."
                );

            }


            /*
            ------------------------------------------------
            UPDATE WALLET
            ------------------------------------------------

            available
                 ↓
            withdrawal lock
            ------------------------------------------------
            */

            transaction.update(
                walletRef,
                {

                    availableBalance:
                        newAvailableBalance,

                    withdrawalBalance:
                        newWithdrawalBalance,

                    pendingBalance:
                        pendingBalance,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );


            /*
            ------------------------------------------------
            CREATE WITHDRAWAL RECORD
            ------------------------------------------------
            */

            transaction.create(
                withdrawalRef,
                {

                    withdrawalId,

                    transactionId,

                    userId,

                    sellerId:
                        userId,

                    amount:
                        withdrawalAmount,

                    currency:
                        "KES",

                    phone,

                    provider:
                        PAYMENT_PROVIDERS.MPESA,

                    paymentMethod:
                        PAYMENT_METHODS.MPESA,

                    status:
                        PAYOUT_STATUS.PENDING,

                    payoutStatus:
                        PAYOUT_STATUS.PENDING,

                    locked:
                        true,

                    fundsLocked:
                        true,

                    createdAt:
                        FieldValue.serverTimestamp(),

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );


            /*
            ------------------------------------------------
            CREATE FINANCIAL LEDGER
            ------------------------------------------------

            This is a DEBIT from seller wallet.

            ------------------------------------------------
            */

            transaction.create(
                transactionRef,
                {

                    transactionId,

                    type:
                        TRANSACTION_TYPES.WALLET_WITHDRAWAL,

                    userId,

                    sellerId:
                        userId,

                    withdrawalId,

                    orderId:
                        null,

                    paymentId:
                        null,

                    buyerId:
                        null,

                    amount:
                        withdrawalAmount,

                    currency:
                        "KES",

                    commissionRate:
                        0,

                    commissionAmount:
                        0,

                    sellerGross:
                        withdrawalAmount,

                    sellerNet:
                        withdrawalAmount,

                    paymentMethod:
                        PAYMENT_METHODS.MPESA,

                    provider:
                        PAYMENT_PROVIDERS.MPESA,

                    providerTransactionId:
                        null,

                    status:
                        PAYOUT_STATUS.PENDING,

                    payoutStatus:
                        PAYOUT_STATUS.PENDING,

                    direction:
                        "DEBIT",

                    source:
                        "SELLER_WITHDRAWAL",

                    wallet:
                        "SELLER_AVAILABLE_TO_MPESA",

                    description:
                        `Seller withdrawal request ${withdrawalId}`,

                    metadata: {

                        phoneNumber:
                            phone,

                    },

                    createdAt:
                        FieldValue.serverTimestamp(),

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );

        }
    );


    console.log(
        "=========================================="
    );

    console.log(
        "💸 SELLER WITHDRAWAL CREATED"
    );

    console.log(
        {
            withdrawalId,
            transactionId,
            userId,
            amount: withdrawalAmount,
            phone,
        }
    );

    console.log(
        "=========================================="
    );


    return {

        success:
            true,

        withdrawalId,

        transactionId,

        sellerId:
            userId,

        amount:
            withdrawalAmount,

        currency:
            "KES",

        phone,

        status:
            PAYOUT_STATUS.PENDING,

        message:
            "Withdrawal request created. Funds are locked pending M-Pesa processing.",

    };

}


/*
=========================================================
MARK WITHDRAWAL PROCESSING
=========================================================

Called after B2C request has actually been submitted
to Safaricom.

PENDING
   ↓
PROCESSING

=========================================================
*/

async function markWithdrawalProcessing({

    withdrawalId,

    conversationId = null,

    originatorConversationId = null,

}) {

    const withdrawalRef =
        getWithdrawalRef(
            withdrawalId
        );


    await db.runTransaction(
        async (transaction) => {

            const withdrawalSnap =
                await transaction.get(
                    withdrawalRef
                );


            if (
                !withdrawalSnap.exists
            ) {

                throw new Error(
                    "Withdrawal not found."
                );

            }


            const withdrawal =
                withdrawalSnap.data();


            /*
            ------------------------------------------------
            IDEMPOTENCY
            ------------------------------------------------
            */

            if (
                withdrawal.status ===
                PAYOUT_STATUS.COMPLETED
            ) {

                return;

            }


            if (
                withdrawal.status ===
                PAYOUT_STATUS.FAILED
            ) {

                return;

            }


            /*
            ------------------------------------------------
            PROCESSING
            ------------------------------------------------
            */

            transaction.update(
                withdrawalRef,
                {

                    status:
                        PAYOUT_STATUS.PROCESSING,

                    payoutStatus:
                        PAYOUT_STATUS.PROCESSING,

                    conversationId,

                    originatorConversationId,

                    processingAt:
                        FieldValue.serverTimestamp(),

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );


            /*
            ------------------------------------------------
            UPDATE LEDGER STATUS
            ------------------------------------------------
            */

            if (
                withdrawal.transactionId
            ) {

                const ledgerRef =
                    getTransactionRef(
                        withdrawal.transactionId
                    );


                transaction.update(
                    ledgerRef,
                    {

                        status:
                            PAYOUT_STATUS.PROCESSING,

                        payoutStatus:
                            PAYOUT_STATUS.PROCESSING,

                        updatedAt:
                            FieldValue.serverTimestamp(),

                    }
                );

            }

        }
    );


    return {

        success:
            true,

        withdrawalId,

        status:
            PAYOUT_STATUS.PROCESSING,

    };

}


/*
=========================================================
COMPLETE WITHDRAWAL
=========================================================

Called after successful M-Pesa B2C callback.

IMPORTANT:

availableBalance was already reduced when the withdrawal
was created.

Therefore:

DO NOT subtract availableBalance again.

Only:

withdrawalBalance
      ↓
decreases

totalWithdrawn
      ↓
increases

=========================================================
*/

async function completeWithdrawal({

    withdrawalId,

    transactionId = null,

    mpesaReceiptNumber = null,

    providerResponse = null,

}) {

    const withdrawalRef =
        getWithdrawalRef(
            withdrawalId
        );


    let result;


    await db.runTransaction(
        async (transaction) => {

            /*
            ------------------------------------------------
            READ WITHDRAWAL
            ------------------------------------------------
            */

            const withdrawalSnap =
                await transaction.get(
                    withdrawalRef
                );


            if (
                !withdrawalSnap.exists
            ) {

                throw new Error(
                    "Withdrawal not found."
                );

            }


            const withdrawal =
                withdrawalSnap.data();


            /*
            ------------------------------------------------
            DUPLICATE CALLBACK
            ------------------------------------------------
            */

            if (
                withdrawal.status ===
                PAYOUT_STATUS.COMPLETED
            ) {

                result = {

                    success:
                        true,

                    alreadyCompleted:
                        true,

                    withdrawalId,

                    status:
                        PAYOUT_STATUS.COMPLETED,

                    mpesaReceiptNumber:
                        withdrawal.mpesaReceiptNumber ||
                        null,

                };

                return;

            }


            /*
            ------------------------------------------------
            DO NOT COMPLETE A FAILED WITHDRAWAL
            ------------------------------------------------
            */

            if (
                withdrawal.status ===
                PAYOUT_STATUS.FAILED
            ) {

                throw new Error(
                    "Withdrawal has already failed."
                );

            }


            /*
            ------------------------------------------------
            VALIDATE AMOUNT
            ------------------------------------------------
            */

            const amount =
                validateAmount(
                    withdrawal.amount
                );


            /*
            ------------------------------------------------
            WALLET
            ------------------------------------------------
            */

            const walletRef =
                getWalletRef(
                    withdrawal.userId
                );


            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet not found."
                );

            }


            const wallet =
                walletSnap.data();


            const withdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance
                );


            const totalWithdrawn =
                toMoney(
                    wallet.totalWithdrawn
                );


            /*
            ------------------------------------------------
            VERIFY LOCKED FUNDS
            ------------------------------------------------
            */

            if (
                withdrawalBalance <
                amount
            ) {

                throw new Error(

                    `Insufficient withdrawal balance. ` +
                    `Locked: KES ${withdrawalBalance}. ` +
                    `Required: KES ${amount}.`

                );

            }


            /*
            ------------------------------------------------
            NEW WALLET
            ------------------------------------------------
            */

            const newWithdrawalBalance =
                toMoney(
                    withdrawalBalance -
                    amount
                );


            const newTotalWithdrawn =
                toMoney(
                    totalWithdrawn +
                    amount
                );


            /*
            ------------------------------------------------
            UPDATE WALLET
            ------------------------------------------------
            */

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


            /*
            ------------------------------------------------
            UPDATE WITHDRAWAL
            ------------------------------------------------
            */

            transaction.update(
                withdrawalRef,
                {

                    status:
                        PAYOUT_STATUS.COMPLETED,

                    payoutStatus:
                        PAYOUT_STATUS.COMPLETED,

                    locked:
                        false,

                    fundsLocked:
                        false,

                    mpesaReceiptNumber:
                        mpesaReceiptNumber || null,

                    providerTransactionId:
                        transactionId || null,

                    providerResponse:
                        providerResponse || null,

                    completedAt:
                        FieldValue.serverTimestamp(),

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );


            /*
            ------------------------------------------------
            UPDATE LEDGER
            ------------------------------------------------
            */

            const ledgerTransactionId =
                withdrawal.transactionId ||
                transactionId;


            if (
                ledgerTransactionId
            ) {

                const ledgerRef =
                    getTransactionRef(
                        ledgerTransactionId
                    );


                transaction.update(
                    ledgerRef,
                    {

                        status:
                            PAYMENT_STATUS.COMPLETED,

                        payoutStatus:
                            PAYOUT_STATUS.COMPLETED,

                        providerTransactionId:
                            transactionId || null,

                        metadata: {

                            mpesaReceiptNumber:
                                mpesaReceiptNumber ||
                                null,

                            providerResponse:
                                providerResponse ||
                                null,

                        },

                        updatedAt:
                            FieldValue.serverTimestamp(),

                        completedAt:
                            FieldValue.serverTimestamp(),

                    }
                );

            }


            result = {

                success:
                    true,

                alreadyCompleted:
                    false,

                withdrawalId,

                sellerId:
                    withdrawal.userId,

                amount,

                status:
                    PAYOUT_STATUS.COMPLETED,

                mpesaReceiptNumber,

                remainingWithdrawalBalance:
                    newWithdrawalBalance,

                totalWithdrawn:
                    newTotalWithdrawn,

            };

        }
    );


    console.log(
        "✅ BIASHNET WITHDRAWAL COMPLETED:",
        result
    );


    return result;

}


/*
=========================================================
FAIL WITHDRAWAL
=========================================================

Safaricom failure:

withdrawalBalance
       ↓
       0

amount
       ↓
availableBalance

=========================================================
*/

async function failWithdrawal({

    withdrawalId,

    reason =
        "Withdrawal failed.",

    providerResponse =
        null,

}) {

    const withdrawalRef =
        getWithdrawalRef(
            withdrawalId
        );


    let result;


    await db.runTransaction(
        async (transaction) => {

            /*
            ------------------------------------------------
            READ WITHDRAWAL
            ------------------------------------------------
            */

            const withdrawalSnap =
                await transaction.get(
                    withdrawalRef
                );


            if (
                !withdrawalSnap.exists
            ) {

                throw new Error(
                    "Withdrawal not found."
                );

            }


            const withdrawal =
                withdrawalSnap.data();


            /*
            ------------------------------------------------
            IDEMPOTENCY
            ------------------------------------------------
            */

            if (
                withdrawal.status ===
                    PAYOUT_STATUS.FAILED
            ) {

                result = {

                    success:
                        true,

                    alreadyFailed:
                        true,

                    withdrawalId,

                    status:
                        PAYOUT_STATUS.FAILED,

                };

                return;

            }


            /*
            ------------------------------------------------
            DO NOT REVERSE SUCCESSFUL PAYMENT
            ------------------------------------------------
            */

            if (
                withdrawal.status ===
                PAYOUT_STATUS.COMPLETED
            ) {

                throw new Error(
                    "Withdrawal has already completed."
                );

            }


            /*
            ------------------------------------------------
            AMOUNT
            ------------------------------------------------
            */

            const amount =
                validateAmount(
                    withdrawal.amount
                );


            /*
            ------------------------------------------------
            WALLET
            ------------------------------------------------
            */

            const walletRef =
                getWalletRef(
                    withdrawal.userId
                );


            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet not found."
                );

            }


            const wallet =
                walletSnap.data();


            const availableBalance =
                toMoney(
                    wallet.availableBalance
                );


            const withdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance
                );


            /*
            ------------------------------------------------
            VERIFY FUNDS ARE LOCKED
            ------------------------------------------------
            */

            if (
                withdrawalBalance <
                amount
            ) {

                throw new Error(

                    `Insufficient withdrawal lock. ` +
                    `Locked: KES ${withdrawalBalance}. ` +
                    `Required: KES ${amount}.`

                );

            }


            /*
            ------------------------------------------------
            RETURN MONEY
            ------------------------------------------------
            */

            const newAvailableBalance =
                toMoney(
                    availableBalance +
                    amount
                );


            const newWithdrawalBalance =
                toMoney(
                    withdrawalBalance -
                    amount
                );


            /*
            ------------------------------------------------
            UPDATE WALLET
            ------------------------------------------------
            */

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


            /*
            ------------------------------------------------
            UPDATE WITHDRAWAL
            ------------------------------------------------
            */

            transaction.update(
                withdrawalRef,
                {

                    status:
                        PAYOUT_STATUS.FAILED,

                    payoutStatus:
                        PAYOUT_STATUS.FAILED,

                    locked:
                        false,

                    fundsLocked:
                        false,

                    failureReason:
                        reason,

                    providerResponse:
                        providerResponse || null,

                    failedAt:
                        FieldValue.serverTimestamp(),

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );


            /*
            ------------------------------------------------
            UPDATE LEDGER
            ------------------------------------------------
            */

            if (
                withdrawal.transactionId
            ) {

                const ledgerRef =
                    getTransactionRef(
                        withdrawal.transactionId
                    );


                transaction.update(
                    ledgerRef,
                    {

                        status:
                            PAYOUT_STATUS.FAILED,

                        payoutStatus:
                            PAYOUT_STATUS.FAILED,

                        direction:
                            "DEBIT",

                        metadata: {

                            failureReason:
                                reason,

                            providerResponse:
                                providerResponse ||
                                null,

                        },

                        updatedAt:
                            FieldValue.serverTimestamp(),

                        failedAt:
                            FieldValue.serverTimestamp(),

                    }
                );

            }


            result = {

                success:
                    true,

                alreadyFailed:
                    false,

                withdrawalId,

                sellerId:
                    withdrawal.userId,

                amount,

                status:
                    PAYOUT_STATUS.FAILED,

                availableBalance:
                    newAvailableBalance,

                withdrawalBalance:
                    newWithdrawalBalance,

                message:
                    reason,

            };

        }
    );


    console.log(
        "⚠️ BIASHNET WITHDRAWAL FAILED:",
        result
    );


    return result;

}


/*
=========================================================
CANCEL WITHDRAWAL
=========================================================

User-initiated cancellation. Unlike failWithdrawal() (which
handles a B2C attempt that Safaricom rejected/failed), this
is only allowed while the withdrawal is still PENDING — i.e.
before a B2C request has actually been sent. Once it moves
to PROCESSING, the seller can no longer self-cancel; the
B2C result (success or failure) will resolve it instead.

Reuses the same "return locked funds to availableBalance"
logic as failWithdrawal() rather than duplicating it.
=========================================================
*/

async function cancelWithdrawal({

    withdrawalId,

    userId,

}) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }

    if (!userId) {

        throw new Error(
            "User ID is required."
        );

    }


    const withdrawalRef =
        getWithdrawalRef(
            withdrawalId
        );


    let result;


    await db.runTransaction(
        async (transaction) => {

            const withdrawalSnap =
                await transaction.get(
                    withdrawalRef
                );


            if (
                !withdrawalSnap.exists
            ) {

                const error =
                    new Error(
                        "Withdrawal not found."
                    );

                error.statusCode = 404;

                throw error;

            }


            const withdrawal =
                withdrawalSnap.data();


            if (
                withdrawal.userId !== userId
            ) {

                const error =
                    new Error(
                        "You are not authorized to cancel this withdrawal."
                    );

                error.statusCode = 403;

                throw error;

            }


            if (
                withdrawal.status !==
                PAYOUT_STATUS.PENDING
            ) {

                const error =
                    new Error(
                        "This withdrawal is already being processed and can no longer be cancelled."
                    );

                error.statusCode = 400;

                throw error;

            }


            const amount =
                validateAmount(
                    withdrawal.amount
                );


            const walletRef =
                getWalletRef(
                    withdrawal.userId
                );


            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet not found."
                );

            }


            const wallet =
                walletSnap.data();


            const availableBalance =
                toMoney(
                    wallet.availableBalance
                );


            const withdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance
                );


            if (
                withdrawalBalance <
                amount
            ) {

                throw new Error(

                    `Insufficient withdrawal lock. ` +
                    `Locked: KES ${withdrawalBalance}. ` +
                    `Required: KES ${amount}.`

                );

            }


            const newAvailableBalance =
                toMoney(
                    availableBalance +
                    amount
                );


            const newWithdrawalBalance =
                toMoney(
                    withdrawalBalance -
                    amount
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


            transaction.update(
                withdrawalRef,
                {

                    status:
                        "CANCELLED",

                    payoutStatus:
                        "CANCELLED",

                    locked:
                        false,

                    fundsLocked:
                        false,

                    cancelledAt:
                        FieldValue.serverTimestamp(),

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );


            if (
                withdrawal.transactionId
            ) {

                const ledgerRef =
                    getTransactionRef(
                        withdrawal.transactionId
                    );


                transaction.update(
                    ledgerRef,
                    {

                        status:
                            "CANCELLED",

                        payoutStatus:
                            "CANCELLED",

                        updatedAt:
                            FieldValue.serverTimestamp(),

                    }
                );

            }


            result = {

                success:
                    true,

                withdrawalId,

                status:
                    "CANCELLED",

                availableBalance:
                    newAvailableBalance,

                withdrawalBalance:
                    newWithdrawalBalance,

            };

        }
    );


    console.log(
        "🚫 BIASHNET WITHDRAWAL CANCELLED:",
        result
    );


    return result;

}


/*
=========================================================
GET WITHDRAWAL
=========================================================
*/

async function getWithdrawal(
    withdrawalId
) {

    const withdrawalRef =
        getWithdrawalRef(
            withdrawalId
        );


    const snap =
        await withdrawalRef.get();


    if (
        !snap.exists
    ) {

        return null;

    }


    return {

        id:
            snap.id,

        ...snap.data(),

    };

}


/*
=========================================================
GET SELLER WITHDRAWALS
=========================================================
*/

async function getUserWithdrawals(
    userId
) {

    if (!userId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .where(
                "userId",
                "==",
                userId
            )
            .get();


    const withdrawals =
        snapshot.docs.map(
            document => ({

                id:
                    document.id,

                ...document.data(),

            })
        );


    /*
    Sort in JavaScript so this query does not
    require a Firestore composite index just
    for the basic seller withdrawal page.
    */

    withdrawals.sort(
        (
            a,
            b
        ) => {

            const aTime =
                a.createdAt?.toMillis
                    ? a.createdAt.toMillis()
                    : new Date(
                        a.createdAt || 0
                    ).getTime();


            const bTime =
                b.createdAt?.toMillis
                    ? b.createdAt.toMillis()
                    : new Date(
                        b.createdAt || 0
                    ).getTime();


            return (
                bTime -
                aTime
            );

        }
    );


    return withdrawals;

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    createWithdrawal,

    markWithdrawalProcessing,

    completeWithdrawal,

    failWithdrawal,

    cancelWithdrawal,

    getWithdrawal,

    getUserWithdrawals,

    normalizePhone,

    validatePhone,

    toMoney,

};