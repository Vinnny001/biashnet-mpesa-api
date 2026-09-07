const {
    db,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");

const {
    TRANSACTION_TYPES,
    PAYMENT_STATUS,
    PAYMENT_METHODS,
    PAYMENT_PROVIDERS,
} = require("../config/paymentConstants");

const {
    generateTransactionId,
} = require("../utils/codeGenerator");


/*
=========================================================
BIASHNET TRANSACTION SERVICE
=========================================================

PURPOSE
---------------------------------------------------------

Permanent financial ledger for BIASHNET.

This service:

- validates financial events
- creates immutable ledger records
- supports normal writes
- supports Firestore transactions
- provides deterministic transaction IDs
- prevents duplicate ledger entries
- provides seller/buyer/payment/order queries

IMPORTANT

There are TWO write modes:

1. createTransaction()
   Normal standalone ledger write.

2. createTransactionInTransaction()
   Used INSIDE an existing Firestore transaction.

The second method is critical for:

paymentService
settlementService
refundService
withdrawalService

because wallet + order + ledger must commit atomically.

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
            "Invalid monetary value."
        );

    }

    return Number(
        amount.toFixed(2)
    );

}


/* ========================================================
   REQUIRED VALUE
======================================================== */

function requireValue(
    value,
    field
) {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {

        throw new Error(
            `${field} is required.`
        );

    }

}


/* ========================================================
   STRING
======================================================== */

function normalizeString(
    value,
    fallback = null
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    const result =
        String(value).trim();

    return result || fallback;

}


/* ========================================================
   ENUM
======================================================== */

function normalizeEnum(
    value
) {

    return String(
        value || ""
    )
        .trim()
        .toUpperCase();

}


/* ========================================================
   COMMISSION RATE
======================================================== */

function validateCommissionRate(
    rate
) {

    const numericRate =
        Number(rate);

    if (
        !Number.isFinite(
            numericRate
        ) ||
        numericRate < 0 ||
        numericRate > 1
    ) {

        throw new Error(
            "Invalid commission rate."
        );

    }

    return numericRate;

}


/* ========================================================
   TYPE CHECKS
======================================================== */

function isType(
    type,
    expected
) {

    return (
        normalizeEnum(type) ===
        normalizeEnum(expected)
    );

}


function isMarketplaceSale(
    type
) {

    return isType(
        type,
        TRANSACTION_TYPES.MARKETPLACE_SALE
    );

}


/* ========================================================
   ORDER FINANCIAL VALIDATION
======================================================== */

function validateMarketplaceFinancials({

    amount,

    commissionAmount,

    sellerGross,

    sellerNet,

}) {

    const saleAmount =
        toMoney(amount);

    const commission =
        toMoney(
            commissionAmount
        );

    const gross =
        toMoney(
            sellerGross
        );

    const net =
        toMoney(
            sellerNet
        );


    if (
        saleAmount <= 0
    ) {

        throw new Error(
            "Transaction amount must be greater than zero."
        );

    }


    if (
        commission < 0
    ) {

        throw new Error(
            "Commission cannot be negative."
        );

    }


    if (
        gross < 0
    ) {

        throw new Error(
            "Seller gross cannot be negative."
        );

    }


    if (
        net < 0
    ) {

        throw new Error(
            "Seller net cannot be negative."
        );

    }


    if (
        net > gross
    ) {

        throw new Error(
            "Seller net cannot exceed seller gross."
        );

    }


    /*
    sale
       =
    seller gross
       +
    commission
    */

    if (
        Math.abs(
            toMoney(
                gross +
                commission
            ) -
            saleAmount
        ) > 0.01
    ) {

        throw new Error(
            "Marketplace transaction does not balance."
        );

    }


    /*
    seller net
       =
    seller gross
       -
    commission
    */

    if (
        Math.abs(
            toMoney(
                gross -
                commission
            ) -
            net
        ) > 0.01
    ) {

        throw new Error(
            "Seller net and commission are inconsistent."
        );

    }


    return true;

}


/* ========================================================
   BUILD LEDGER DATA
======================================================== */

function buildTransactionData({

    transactionId,

    type,

    orderId,

    paymentId,

    buyerId = null,

    sellerId = null,

    listingId = null,

    amount,

    currency = "KES",

    commissionRate = 0,

    commissionAmount = 0,

    sellerGross = 0,

    sellerNet = 0,

    paymentMethod =
        PAYMENT_METHODS.MPESA,

    provider =
        PAYMENT_PROVIDERS.MPESA,

    providerTransactionId = null,

    status =
        PAYMENT_STATUS.COMPLETED,

    direction = "CREDIT",

    source = "MARKETPLACE",

    recipient = null,

    wallet = null,

    payoutStatus = null,

    metadata = {},

}) {

    requireValue(
        type,
        "Transaction type"
    );

    requireValue(
        orderId,
        "Order ID"
    );


    const marketplaceTypes = [

        TRANSACTION_TYPES.MARKETPLACE_SALE,

        TRANSACTION_TYPES.COMMISSION,

        TRANSACTION_TYPES.SELLER_PAYOUT,

        TRANSACTION_TYPES.REFUND,

        TRANSACTION_TYPES.PAYMENT,

        TRANSACTION_TYPES.SELLER_HOLD,

    ];


    if (
        marketplaceTypes
            .map(normalizeEnum)
            .includes(
                normalizeEnum(type)
            )
    ) {

        requireValue(
            paymentId,
            "Payment ID"
        );

        requireValue(
            buyerId,
            "Buyer ID"
        );

    }


    const sellerTypes = [

        TRANSACTION_TYPES.MARKETPLACE_SALE,

        TRANSACTION_TYPES.COMMISSION,

        TRANSACTION_TYPES.SELLER_PAYOUT,

        TRANSACTION_TYPES.SELLER_HOLD,

        TRANSACTION_TYPES.WALLET_WITHDRAWAL,

        TRANSACTION_TYPES.WITHDRAWAL,

    ];


    if (
        sellerTypes
            .map(normalizeEnum)
            .includes(
                normalizeEnum(type)
            )
    ) {

        requireValue(
            sellerId,
            "Seller ID"
        );

    }


    const transactionAmount =
        toMoney(amount);


    if (
        transactionAmount <= 0
    ) {

        throw new Error(
            "Transaction amount must be greater than zero."
        );

    }


    const normalizedCommissionRate =
        validateCommissionRate(
            commissionRate
        );


    const normalizedCommission =
        toMoney(
            commissionAmount
        );


    const normalizedSellerGross =
        toMoney(
            sellerGross
        );


    const normalizedSellerNet =
        toMoney(
            sellerNet
        );


    if (
        isMarketplaceSale(
            type
        )
    ) {

        validateMarketplaceFinancials({

            amount:
                transactionAmount,

            commissionAmount:
                normalizedCommission,

            sellerGross:
                normalizedSellerGross,

            sellerNet:
                normalizedSellerNet,

        });

    }


    return {

        transactionId,

        type:
            normalizeString(type),

        orderId:
            normalizeString(orderId),

        paymentId:
            normalizeString(paymentId),

        buyerId:
            normalizeString(buyerId),

        sellerId:
            normalizeString(sellerId),

        listingId:
            normalizeString(listingId),

        amount:
            transactionAmount,

        currency:
            normalizeString(
                currency,
                "KES"
            ),

        commissionRate:
            normalizedCommissionRate,

        commissionPercentage:
            normalizedCommissionRate * 100,

        commissionAmount:
            normalizedCommission,

        sellerGross:
            normalizedSellerGross,

        sellerNet:
            normalizedSellerNet,

        paymentMethod:
            normalizeString(
                paymentMethod
            ),

        provider:
            normalizeString(
                provider
            ),

        providerTransactionId:
            normalizeString(
                providerTransactionId
            ),

        status:
            normalizeString(
                status
            ),

        direction:
            normalizeEnum(
                direction
            ) || "CREDIT",

        source:
            normalizeString(
                source,
                "MARKETPLACE"
            ),

        recipient:
            normalizeString(
                recipient
            ),

        wallet:
            normalizeString(
                wallet
            ),

        payoutStatus:
            normalizeString(
                payoutStatus
            ),

        metadata:
            metadata &&
            typeof metadata === "object"
                ? metadata
                : {},

        createdAt:
            new Date(),

        updatedAt:
            new Date(),

    };

}


/* ========================================================
   CREATE TRANSACTION
========================================================

Standalone write.

Use this when no outer Firestore transaction exists.
========================================================
*/

async function createTransaction(
    options
) {

    const finalTransactionId =
        options.transactionId ||
        generateTransactionId();


    const transactionRef =
        db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                finalTransactionId
            );


    const existing =
        await transactionRef.get();


    if (
        existing.exists
    ) {

        return {

            success:
                true,

            alreadyExists:
                true,

            transactionId:
                finalTransactionId,

            transaction: {

                id:
                    existing.id,

                ...existing.data(),

            },

        };

    }


    const transactionData =
        buildTransactionData({

            ...options,

            transactionId:
                finalTransactionId,

        });


    await transactionRef.create(
        transactionData
    );


    console.log(
        "💰 TRANSACTION CREATED:",
        finalTransactionId,
        transactionData.type,
        transactionData.amount
    );


    return {

        success:
            true,

        alreadyExists:
            false,

        transactionId:
            finalTransactionId,

        transaction:
            transactionData,

    };

}


/* ========================================================
   CREATE TRANSACTION INSIDE FIRESTORE TRANSACTION
========================================================

CRITICAL METHOD.

This method does NOT call:

transactionRef.get()
transactionRef.create()
outside the transaction.

It uses the Firestore Transaction object provided
by paymentService / settlementService.

========================================================
*/

async function createTransactionInTransaction({

    transaction,

    transactionId,

    type,

    orderId,

    paymentId,

    buyerId = null,

    sellerId = null,

    listingId = null,

    amount,

    currency = "KES",

    commissionRate = 0,

    commissionAmount = 0,

    sellerGross = 0,

    sellerNet = 0,

    paymentMethod =
        PAYMENT_METHODS.MPESA,

    provider =
        PAYMENT_PROVIDERS.MPESA,

    providerTransactionId = null,

    status =
        PAYMENT_STATUS.COMPLETED,

    direction = "CREDIT",

    source = "MARKETPLACE",

    recipient = null,

    wallet = null,

    payoutStatus = null,

    metadata = {},

}) {

    if (
        !transaction ||
        typeof transaction.set !==
        "function"
    ) {

        throw new Error(
            "Firestore transaction object is required."
        );

    }


    requireValue(
        transactionId,
        "Transaction ID"
    );


    const transactionRef =
        db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                transactionId
            );


    const transactionData =
        buildTransactionData({

            transactionId,

            type,

            orderId,

            paymentId,

            buyerId,

            sellerId,

            listingId,

            amount,

            currency,

            commissionRate,

            commissionAmount,

            sellerGross,

            sellerNet,

            paymentMethod,

            provider,

            providerTransactionId,

            status,

            direction,

            source,

            recipient,

            wallet,

            payoutStatus,

            metadata,

        });


    /*
    We use set with merge.

    This allows callers to safely combine this
    helper with a read they already performed.
    */

    transaction.set(
        transactionRef,
        transactionData,
        {
            merge: false,
        }
    );


    return {

        transactionId,

        transactionRef,

        transaction:
            transactionData,

    };

}


/* ========================================================
   MARKETPLACE SALE
========================================================
*/

async function createMarketplaceSaleTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId = null,

    amount,

    commissionRate = 0,

    commissionAmount,

    sellerGross,

    sellerNet,

    providerTransactionId,

    paymentMethod =
        PAYMENT_METHODS.MPESA,

    provider =
        PAYMENT_PROVIDERS.MPESA,

    metadata = {},

}) {

    return createTransaction({

        transactionId:
            `SALE_${orderId}_${sellerId}`,

        type:
            TRANSACTION_TYPES.MARKETPLACE_SALE,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount,

        commissionRate,

        commissionAmount,

        sellerGross,

        sellerNet,

        currency:
            "KES",

        paymentMethod,

        provider,

        providerTransactionId,

        status:
            PAYMENT_STATUS.COMPLETED,

        direction:
            "CREDIT",

        source:
            "MARKETPLACE_ORDER",

        metadata,

    });

}


/* ========================================================
   PAYMENT
========================================================
*/

async function createPaymentTransaction({

    orderId,

    paymentId,

    buyerId,

    amount,

    providerTransactionId = null,

    paymentMethod =
        PAYMENT_METHODS.MPESA,

    provider =
        PAYMENT_PROVIDERS.MPESA,

    metadata = {},

}) {

    return createTransaction({

        transactionId:
            `PAYMENT_${paymentId}`,

        type:
            TRANSACTION_TYPES.PAYMENT,

        orderId,

        paymentId,

        buyerId,

        amount,

        currency:
            "KES",

        commissionRate:
            0,

        commissionAmount:
            0,

        sellerGross:
            0,

        sellerNet:
            0,

        paymentMethod,

        provider,

        providerTransactionId,

        status:
            PAYMENT_STATUS.COMPLETED,

        direction:
            "CREDIT",

        source:
            "MPESA",

        metadata,

    });

}


/* ========================================================
   SELLER HOLD
========================================================
*/

async function createSellerHoldTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId = null,

    amount,

    commissionAmount = 0,

    sellerGross,

    sellerNet,

    providerTransactionId = null,

    metadata = {},

}) {

    return createTransaction({

        transactionId:
            `HOLD_${orderId}_${sellerId}`,

        type:
            TRANSACTION_TYPES.SELLER_HOLD,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount,

        currency:
            "KES",

        commissionRate:
            0,

        commissionAmount,

        sellerGross,

        sellerNet,

        paymentMethod:
            PAYMENT_METHODS.WALLET,

        provider:
            "BIASHNET_ESCROW",

        providerTransactionId,

        status:
            PAYMENT_STATUS.COMPLETED,

        direction:
            "CREDIT",

        source:
            "MARKETPLACE_HOLD",

        wallet:
            "SELLER_PENDING",

        metadata,

    });

}


/* ========================================================
   COMMISSION
========================================================
*/

async function createCommissionTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId = null,

    amount,

    commissionRate = 0,

    providerTransactionId = null,

    metadata = {},

}) {

    return createTransaction({

        transactionId:
            `COMMISSION_${orderId}_${sellerId}`,

        type:
            TRANSACTION_TYPES.COMMISSION,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount,

        currency:
            "KES",

        commissionRate,

        commissionAmount:
            amount,

        sellerGross:
            0,

        sellerNet:
            0,

        paymentMethod:
            PAYMENT_METHODS.MPESA,

        provider:
            PAYMENT_PROVIDERS.MPESA,

        providerTransactionId,

        status:
            PAYMENT_STATUS.COMPLETED,

        direction:
            "CREDIT",

        recipient:
            "BIASHNET",

        wallet:
            "COMPANY_WALLET",

        source:
            "MARKETPLACE_COMMISSION",

        metadata,

    });

}


/* ========================================================
   SELLER PAYOUT
========================================================
*/

async function createSellerPayoutTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId = null,

    amount,

    metadata = {},

}) {

    return createTransaction({

        transactionId:
            `PAYOUT_${orderId}_${sellerId}`,

        type:
            TRANSACTION_TYPES.SELLER_PAYOUT,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount,

        currency:
            "KES",

        commissionRate:
            0,

        commissionAmount:
            0,

        sellerGross:
            amount,

        sellerNet:
            amount,

        paymentMethod:
            PAYMENT_METHODS.WALLET,

        provider:
            "BIASHNET_WALLET",

        status:
            PAYMENT_STATUS.COMPLETED,

        payoutStatus:
            "COMPLETED",

        direction:
            "CREDIT",

        source:
            "MARKETPLACE_SETTLEMENT",

        wallet:
            "SELLER_AVAILABLE",

        metadata,

    });

}


/* ========================================================
   WITHDRAWAL
========================================================
*/

async function createWithdrawalTransaction({

    orderId = null,

    paymentId = null,

    buyerId = null,

    sellerId,

    amount,

    providerTransactionId = null,

    phoneNumber = null,

    withdrawalRequestId = null,

    status =
        PAYMENT_STATUS.COMPLETED,

    metadata = {},

}) {

    requireValue(
        sellerId,
        "Seller ID"
    );


    const withdrawalAmount =
        toMoney(amount);


    if (
        withdrawalAmount <= 0
    ) {

        throw new Error(
            "Withdrawal amount must be greater than zero."
        );

    }


    const transactionId =
        withdrawalRequestId
            ? `WITHDRAWAL_${withdrawalRequestId}`
            : `WITHDRAWAL_${sellerId}_${Date.now()}`;


    return createTransaction({

        transactionId,

        type:
            TRANSACTION_TYPES.WALLET_WITHDRAWAL,

        orderId,

        paymentId,

        buyerId,

        sellerId,

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
            PAYMENT_METHODS.WALLET,

        provider:
            PAYMENT_PROVIDERS.MPESA,

        providerTransactionId,

        status,

        direction:
            "DEBIT",

        source:
            "SELLER_WITHDRAWAL",

        metadata: {

            ...metadata,

            phoneNumber:
                phoneNumber || null,

            withdrawalRequestId:
                withdrawalRequestId || null,

        },

    });

}


/* ========================================================
   REFUND
========================================================
*/

async function createRefundTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId = null,

    listingId = null,

    amount,

    providerTransactionId = null,

    metadata = {},

}) {

    return createTransaction({

        transactionId:
            `REFUND_${orderId}`,

        type:
            TRANSACTION_TYPES.REFUND,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount,

        currency:
            "KES",

        commissionRate:
            0,

        commissionAmount:
            0,

        sellerGross:
            0,

        sellerNet:
            0,

        paymentMethod:
            PAYMENT_METHODS.MPESA,

        provider:
            PAYMENT_PROVIDERS.MPESA,

        providerTransactionId,

        status:
            PAYMENT_STATUS.REFUNDED,

        direction:
            "DEBIT",

        source:
            "MARKETPLACE_REFUND",

        metadata,

    });

}


/* ========================================================
   GET TRANSACTION
========================================================
*/

async function getTransaction(
    transactionId
) {

    requireValue(
        transactionId,
        "Transaction ID"
    );


    const snap =
        await db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                transactionId
            )
            .get();


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


/* ========================================================
   GET ORDER TRANSACTIONS
========================================================
*/

async function getOrderTransactions(
    orderId
) {

    requireValue(
        orderId,
        "Order ID"
    );


    const snapshot =
        await db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .where(
                "orderId",
                "==",
                orderId
            )
            .get();


    return snapshot.docs.map(
        document => ({

            id:
                document.id,

            ...document.data(),

        })
    );

}


/* ========================================================
   GET SELLER TRANSACTIONS
========================================================
*/

async function getSellerTransactions(
    sellerId,
    options = {}
) {

    requireValue(
        sellerId,
        "Seller ID"
    );


    let limit =
        Number(
            options.limit || 100
        );


    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {

        limit = 100;

    }


    if (
        limit > 500
    ) {

        limit = 500;

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .where(
                "sellerId",
                "==",
                sellerId
            )
            .limit(
                limit
            )
            .get();


    const transactions =
        snapshot.docs.map(
            document => ({

                id:
                    document.id,

                ...document.data(),

            })
        );


    transactions.sort(
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


            return bTime - aTime;

        }
    );


    return transactions;

}


/* ========================================================
   GET BUYER TRANSACTIONS
========================================================
*/

async function getBuyerTransactions(
    buyerId,
    options = {}
) {

    requireValue(
        buyerId,
        "Buyer ID"
    );


    let limit =
        Number(
            options.limit || 100
        );


    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {

        limit = 100;

    }


    if (
        limit > 500
    ) {

        limit = 500;

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .where(
                "buyerId",
                "==",
                buyerId
            )
            .limit(
                limit
            )
            .get();


    const transactions =
        snapshot.docs.map(
            document => ({

                id:
                    document.id,

                ...document.data(),

            })
        );


    transactions.sort(
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


            return bTime - aTime;

        }
    );


    return transactions;

}


/* ========================================================
   GET PAYMENT TRANSACTIONS
========================================================
*/

async function getPaymentTransactions(
    paymentId
) {

    requireValue(
        paymentId,
        "Payment ID"
    );


    const snapshot =
        await db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .where(
                "paymentId",
                "==",
                paymentId
            )
            .get();


    return snapshot.docs.map(
        document => ({

            id:
                document.id,

            ...document.data(),

        })
    );

}


/* ========================================================
   EXPORTS
========================================================
*/

module.exports = {

    createTransaction,

    createTransactionInTransaction,

    createMarketplaceSaleTransaction,

    createPaymentTransaction,

    createSellerHoldTransaction,

    createCommissionTransaction,

    createSellerPayoutTransaction,

    createWithdrawalTransaction,

    createRefundTransaction,

    getTransaction,

    getOrderTransactions,

    getSellerTransactions,

    getBuyerTransactions,

    getPaymentTransactions,

    toMoney,

};