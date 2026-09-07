/*
=========================================================
BIASHNET SETTLEMENT SERVICE
=========================================================

RESPONSIBILITY
---------------------------------------------------------

Releases HELD seller funds after successful delivery
confirmation.

FLOW:

PAYMENT
   ↓
ORDER PAID
   ↓
SELLER FUNDS HELD
   ↓
BUYER RECEIVES COMPLETION CODE
   ↓
SELLER DELIVERS
   ↓
SELLER VERIFIES COMPLETION CODE
   ↓
SETTLEMENT SERVICE
   ↓
SELLER PENDING BALANCE DECREASED
   ↓
SELLER AVAILABLE BALANCE INCREASED
   ↓
BIASHNET COMPANY WALLET CREDITED
   ↓
LEDGER TRANSACTIONS CREATED
   ↓
SELLER PAYOUT RELEASED

IMPORTANT:

This service:

- does NOT initiate M-Pesa
- does NOT send STK
- does NOT process callbacks
- does NOT verify the completion code
- does NOT initiate withdrawals

It ONLY releases funds already held by the
payment/marketplace flow.

=========================================================
MULTI-SELLER SUPPORT
=========================================================

An order may contain:

sellerBreakdown: [

  {
    sellerId,
    grossAmount,
    commissionAmount,
    sellerNet,
    sellerPaymentStatus,
    payoutStatus
  },

  ...
]

Settlement is therefore performed ONE SELLER AT A TIME.

sellerId MUST identify the specific seller being settled.

=========================================================
*/


const {
    db,
    FieldValue,
} = require("../config/firebase");


const {
    COLLECTIONS,
} = require("../config/collections");


const {
    PAYMENT_STATUS,
    ORDER_STATUS,
    SELLER_PAYMENT_STATUS,
    PAYOUT_STATUS,
    TRANSACTION_TYPES,
} = require("../config/paymentConstants");

const walletService =
    require("./wallet");


/*
=========================================================
COMPANY WALLET
=========================================================

We intentionally keep the company wallet separate from
seller wallets.

Preferred:

COLLECTIONS.COMPANY_WALLETS

If your constants do not yet contain COMPANY_WALLETS,
we safely fall back to:

companyWallets

Document:

companyWallets/BIASHNET

=========================================================
*/

const COMPANY_WALLET_COLLECTION =
    COLLECTIONS.COMPANY_WALLETS ||
    "companyWallets";


const COMPANY_WALLET_ID =
    "BIASHNET";


/*
=========================================================
MONEY
=========================================================
*/

function toMoney(value) {

    const amount =
        Number(value);

    if (
        !Number.isFinite(amount)
    ) {

        return 0;

    }

    return Number(
        amount.toFixed(2)
    );

}


/*
=========================================================
NORMALIZE STATUS
=========================================================
*/

function normalizeStatus(value) {

    return String(
        value || ""
    )
        .trim()
        .toUpperCase();

}


/*
=========================================================
SELLER WALLET REFERENCE
=========================================================
*/

function getSellerWalletRef(
    sellerId
) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required for wallet."
        );

    }

    return db
        .collection(
            COLLECTIONS.WALLETS
        )
        .doc(
            sellerId
        );

}


/*
=========================================================
COMPANY WALLET REFERENCE
=========================================================
*/

function getCompanyWalletRef() {

    return db
        .collection(
            COMPANY_WALLET_COLLECTION
        )
        .doc(
            COMPANY_WALLET_ID
        );

}


/*
=========================================================
GET SELLER BREAKDOWN
=========================================================
*/

function getSellerBreakdown(
    order,
    sellerId
) {

    if (
        !Array.isArray(
            order.sellerBreakdown
        )
    ) {

        return null;

    }

    return (
        order.sellerBreakdown.find(
            seller =>
                seller &&
                seller.sellerId ===
                sellerId
        ) ||
        null
    );

}


/*
=========================================================
SETTLE MARKETPLACE ORDER
=========================================================

Settles ONE seller portion of an order.

Example:

settleMarketplaceOrder({
    orderId,
    sellerId,
    completionCodeVerified: true
});

=========================================================
*/

async function settleMarketplaceOrder({

    orderId,

    sellerId,

    completionCodeVerified = false,

}) {

    /*
    =====================================================
    BASIC VALIDATION
    =====================================================
    */

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    if (
        completionCodeVerified !== true
    ) {

        throw new Error(
            "Seller settlement requires a verified completion code."
        );

    }


    /*
    =====================================================
    REFERENCES
    =====================================================
    */

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            );


    const sellerWalletRef =
        getSellerWalletRef(
            sellerId
        );


    const companyWalletRef =
        getCompanyWalletRef();


    /*
    =====================================================
    RESULT HOLDER
    =====================================================
    */

    let result;


    /*
    =====================================================
    ATOMIC SETTLEMENT
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            =================================================
            1. READ ORDER
            =================================================
            */

            const orderSnap =
                await transaction.get(
                    orderRef
                );


            if (
                !orderSnap.exists
            ) {

                throw new Error(
                    "Marketplace order not found."
                );

            }


            const order =
                orderSnap.data();


            /*
            =================================================
            2. FIND SELLER PORTION
            =================================================
            */

            const sellerBreakdown =
                getSellerBreakdown(
                    order,
                    sellerId
                );


            if (
                !sellerBreakdown
            ) {

                throw new Error(
                    "Seller is not part of this order."
                );

            }


            /*
            =================================================
            3. PAYMENT
            =================================================
            */

            if (
                normalizeStatus(
                    order.paymentStatus
                ) !==
                normalizeStatus(
                    PAYMENT_STATUS.COMPLETED
                )
            ) {

                throw new Error(
                    "Order payment has not been completed."
                );

            }


            /*
            =================================================
            4. ORDER
            =================================================
            */

            if (
                normalizeStatus(
                    order.status
                ) !==
                normalizeStatus(
                    ORDER_STATUS.COMPLETED
                )
            ) {

                throw new Error(
                    "Order must be completed before settlement."
                );

            }


            /*
            =================================================
            5. SELLER MUST STILL BE HELD
            =================================================
            */

            const sellerPaymentStatus =
                normalizeStatus(
                    sellerBreakdown.sellerPaymentStatus
                );


            const sellerPayoutStatus =
                normalizeStatus(
                    sellerBreakdown.payoutStatus
                );


            /*
            =================================================
            6. IDEMPOTENCY

            This is IMPORTANT.

            A repeated callback, repeated API request, or
            repeated seller verification must NEVER credit
            the seller twice.

            We use the seller's payout status.
            =================================================
            */

            if (

                sellerPaymentStatus ===
                    normalizeStatus(
                        SELLER_PAYMENT_STATUS.RELEASED
                    )

                ||

                sellerPayoutStatus ===
                    normalizeStatus(
                        PAYOUT_STATUS.COMPLETED
                    )

            ) {

                result = {

                    success:
                        true,

                    alreadySettled:
                        true,

                    orderId,

                    sellerId,

                    sellerAmount:
                        toMoney(
                            sellerBreakdown.sellerNet
                        ),

                    commissionAmount:
                        toMoney(
                            sellerBreakdown.commissionAmount
                        ),

                    status:
                        "SETTLED",

                };

                return;

            }


            /*
            =================================================
            7. SELLER FUNDS MUST BE HELD
            =================================================
            */

            if (
                sellerPaymentStatus !==
                normalizeStatus(
                    SELLER_PAYMENT_STATUS.HELD
                )
            ) {

                throw new Error(
                    "Seller funds are not currently in HELD state."
                );

            }


            /*
            =================================================
            8. GET AUTHORITATIVE AMOUNTS
            =================================================
            */

            const sellerGross =
                toMoney(
                    sellerBreakdown.grossAmount ||
                    sellerBreakdown.sellerGross
                );


            const commissionAmount =
                toMoney(
                    sellerBreakdown.commissionAmount
                );


            const sellerAmount =
                toMoney(
                    sellerBreakdown.sellerNet
                );


            /*
            =================================================
            9. FINANCIAL VALIDATION
            =================================================
            */

            if (
                sellerGross <= 0
            ) {

                throw new Error(
                    "Invalid seller gross amount."
                );

            }


            if (
                commissionAmount < 0
            ) {

                throw new Error(
                    "Invalid commission amount."
                );

            }


            if (
                sellerAmount <= 0
            ) {

                throw new Error(
                    "Invalid seller settlement amount."
                );

            }


            const calculatedNet =
                toMoney(
                    sellerGross -
                    commissionAmount
                );


            if (
                calculatedNet !==
                sellerAmount
            ) {

                throw new Error(
                    `Seller settlement mismatch. Gross: ${sellerGross}, Commission: ${commissionAmount}, Net: ${sellerAmount}.`
                );

            }


            /*
            =================================================
            10. READ SELLER WALLET
            =================================================
            */

            const sellerWalletSnap =
                await transaction.get(
                    sellerWalletRef
                );


            const sellerWallet =
                sellerWalletSnap.exists
                    ? sellerWalletSnap.data()
                    : {};


            const sellerAvailableBalance =
                toMoney(
                    sellerWallet.availableBalance
                );


            const sellerPendingBalance =
                toMoney(
                    sellerWallet.pendingBalance
                );


            const sellerTotalEarned =
                toMoney(
                    sellerWallet.totalEarned
                );


            /*
            =================================================
            11. VERIFY HELD BALANCE
            =================================================

            IMPORTANT:

            The payment processing stage must have placed
            sellerNet into pendingBalance.

            Settlement cannot create money.

            =================================================
            */

            if (
                sellerPendingBalance <
                sellerAmount
            ) {

                throw new Error(

                    `Insufficient held seller funds. ` +
                    `Pending: KES ${sellerPendingBalance}. ` +
                    `Required: KES ${sellerAmount}.`

                );

            }


            /*
            =================================================
            12. READ COMPANY WALLET
            =================================================
            */

            const companyWalletSnap =
                await transaction.get(
                    companyWalletRef
                );


            const companyWallet =
                companyWalletSnap.exists
                    ? companyWalletSnap.data()
                    : {};


            const companyAvailableBalance =
                toMoney(
                    companyWallet.availableBalance
                );


            const companyTotalCommission =
                toMoney(
                    companyWallet.totalCommission
                );


            const companyTotalRevenue =
                toMoney(
                    companyWallet.totalRevenue
                );


            /*
            =================================================
            13. NEW SELLER BALANCES
            =================================================
            */

            const newSellerPending =
                toMoney(
                    sellerPendingBalance -
                    sellerAmount
                );


            const newSellerAvailable =
                toMoney(
                    sellerAvailableBalance +
                    sellerAmount
                );


            const newSellerTotalEarned =
                toMoney(
                    sellerTotalEarned +
                    sellerAmount
                );


            /*
            =================================================
            14. NEW COMPANY BALANCE
            =================================================
            */

            const newCompanyAvailable =
                toMoney(
                    companyAvailableBalance +
                    commissionAmount
                );


            const newCompanyCommission =
                toMoney(
                    companyTotalCommission +
                    commissionAmount
                );


            const newCompanyRevenue =
                toMoney(
                    companyTotalRevenue +
                    commissionAmount
                );


            /*
            =================================================
            15. UPDATE SELLER WALLET
            =================================================
            */

            transaction.set(

                sellerWalletRef,

                {

                    userId:
                        sellerId,

                    availableBalance:
                        newSellerAvailable,

                    pendingBalance:
                        newSellerPending,

                    totalEarned:
                        newSellerTotalEarned,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                },

                {
                    merge: true
                }

            );


            /*
            =================================================
            16. UPDATE COMPANY WALLET
            =================================================
            */

            transaction.set(

                companyWalletRef,

                {

                    walletId:
                        COMPANY_WALLET_ID,

                    name:
                        "BIASHNET Company Wallet",

                    availableBalance:
                        newCompanyAvailable,

                    totalCommission:
                        newCompanyCommission,

                    totalRevenue:
                        newCompanyRevenue,

                    currency:
                        "KES",

                    updatedAt:
                        FieldValue.serverTimestamp(),

                },

                {
                    merge: true
                }

            );


            /*
            =================================================
            17. BUILD UPDATED SELLER BREAKDOWN
            =================================================
            */

            const updatedSellerBreakdown =
                order.sellerBreakdown.map(
                    seller => {

                        if (
                            seller.sellerId !==
                            sellerId
                        ) {

                            return seller;

                        }


                        return {

                            ...seller,

                            sellerPaymentStatus:
                                SELLER_PAYMENT_STATUS.RELEASED,

                            payoutStatus:
                                PAYOUT_STATUS.COMPLETED,

                            settlementStatus:
                                "SETTLED",

                            sellerPayoutAmount:
                                sellerAmount,

                            commissionSettled:
                                commissionAmount,

                            settledAt:
                                FieldValue.serverTimestamp(),

                        };

                    }
                );


            /*
            =================================================
            18. CHECK WHETHER ALL SELLERS ARE SETTLED
            =================================================
            */

            const allSellersSettled =
                updatedSellerBreakdown.every(
                    seller => {

                        const status =
                            normalizeStatus(
                                seller.sellerPaymentStatus
                            );

                        const payout =
                            normalizeStatus(
                                seller.payoutStatus
                            );

                        return (

                            status ===
                            normalizeStatus(
                                SELLER_PAYMENT_STATUS.RELEASED
                            )

                            &&

                            payout ===
                            normalizeStatus(
                                PAYOUT_STATUS.COMPLETED
                            )

                        );

                    }
                );


            /*
            =================================================
            19. CREATE SELLER LEDGER TRANSACTION
            =================================================

            Deterministic ID prevents duplicate ledger
            entries when the same seller settlement is
            accidentally retried.

            =================================================
            */

            const sellerTransactionId =
                `SETTLEMENT_${orderId}_${sellerId}`;


            const sellerTransactionRef =
                db
                    .collection(
                        COLLECTIONS.TRANSACTIONS
                    )
                    .doc(
                        sellerTransactionId
                    );


            const existingSellerTransaction =
                await transaction.get(
                    sellerTransactionRef
                );


            if (
                !existingSellerTransaction.exists
            ) {

                transaction.create(

                    sellerTransactionRef,

                    {

                        transactionId:
                            sellerTransactionId,

                        type:
                            TRANSACTION_TYPES.SELLER_PAYOUT,

                        orderId,

                        sellerId,

                        buyerId:
                            order.buyerId ||
                            null,

                        paymentId:
                            order.paymentId ||
                            null,

                        amount:
                            sellerAmount,

                        saleAmount:
                            sellerGross,

                        commissionAmount,

                        currency:
                            "KES",

                        status:
                            PAYMENT_STATUS.COMPLETED,

                        payoutStatus:
                            PAYOUT_STATUS.COMPLETED,

                        direction:
                            "CREDIT",

                        source:
                            "MARKETPLACE_ORDER",

                        description:
                            `Seller settlement for order ${orderId}`,

                        createdAt:
                            FieldValue.serverTimestamp(),

                        completedAt:
                            FieldValue.serverTimestamp(),

                    }

                );

            }


            /*
            =================================================
            20. CREATE COMPANY COMMISSION LEDGER
            =================================================
            */

            let commissionTransactionId = null;


            if (
                commissionAmount > 0
            ) {

                commissionTransactionId =
                    `COMMISSION_${orderId}_${sellerId}`;


                const commissionTransactionRef =
                    db
                        .collection(
                            COLLECTIONS.TRANSACTIONS
                        )
                        .doc(
                            commissionTransactionId
                        );


                const existingCommissionTransaction =
                    await transaction.get(
                        commissionTransactionRef
                    );


                if (
                    !existingCommissionTransaction.exists
                ) {

                    transaction.create(

                        commissionTransactionRef,

                        {

                            transactionId:
                                commissionTransactionId,

                            type:
                                TRANSACTION_TYPES.COMMISSION_SETTLEMENT,

                            orderId,

                            sellerId,

                            buyerId:
                                order.buyerId ||
                                null,

                            paymentId:
                                order.paymentId ||
                                null,

                            amount:
                                commissionAmount,

                            currency:
                                "KES",

                            status:
                                PAYMENT_STATUS.COMPLETED,

                            direction:
                                "CREDIT",

                            recipient:
                                "BIASHNET",

                            wallet:
                                "COMPANY_WALLET",

                            source:
                                "MARKETPLACE_ORDER",

                            description:
                                `BIASHNET commission for order ${orderId}`,

                            createdAt:
                                FieldValue.serverTimestamp(),

                        }

                    );

                }

            }


            /*
            =================================================
            21. UPDATE ORDER
            =================================================

            IMPORTANT:

            We update ONLY this seller's portion.

            Other sellers remain HELD until their own
            completion verification occurs.

            =================================================
            */

            const orderUpdate = {

                sellerBreakdown:
                    updatedSellerBreakdown,

                updatedAt:
                    FieldValue.serverTimestamp(),

            };


            /*
            =================================================
            IF ALL SELLERS ARE SETTLED
            =================================================
            */

            if (
                allSellersSettled
            ) {

                orderUpdate.fundsHeld =
                    false;

                orderUpdate.fundsReleased =
                    true;

                orderUpdate.sellerPaymentStatus =
                    SELLER_PAYMENT_STATUS.RELEASED;

                orderUpdate.payoutStatus =
                    PAYOUT_STATUS.COMPLETED;

                orderUpdate.settlementStatus =
                    "SETTLED";

                orderUpdate.settledAt =
                    FieldValue.serverTimestamp();

            } else {

                /*
                ------------------------------------------------
                SOME SELLERS STILL HELD
                ------------------------------------------------
                */

                orderUpdate.fundsHeld =
                    true;

                orderUpdate.fundsReleased =
                    false;

                orderUpdate.settlementStatus =
                    "PARTIALLY_SETTLED";

            }


            transaction.update(
                orderRef,
                orderUpdate
            );


            /*
            =================================================
            22. RESULT
            =================================================
            */

            result = {

                success:
                    true,

                alreadySettled:
                    false,

                orderId,

                sellerId,

                saleAmount:
                    sellerGross,

                commissionAmount,

                sellerAmount,

                sellerPendingBalance:
                    newSellerPending,

                sellerAvailableBalance:
                    newSellerAvailable,

                companyWalletCredit:
                    commissionAmount,

                companyAvailableBalance:
                    newCompanyAvailable,

                allSellersSettled,

                status:
                    "SETTLED",

                sellerTransactionId,

                commissionTransactionId,

            };

        }
    );


    /*
    =======================================================
    LOG
    =======================================================
    */

    console.log(
        "=========================================="
    );

    console.log(
        "✅ BIASHNET SELLER SETTLEMENT COMPLETE"
    );

    console.log(
        result
    );

    console.log(
        "=========================================="
    );


    return result;

}


/*
=========================================================
GET SETTLEMENT STATUS
=========================================================
*/

async function getSettlementStatus(
    orderId
) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const orderSnap =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            )
            .get();


    if (
        !orderSnap.exists
    ) {

        return null;

    }


    const order =
        orderSnap.data();


    const sellerBreakdown =
        Array.isArray(
            order.sellerBreakdown
        )
            ? order.sellerBreakdown
            : [];


    const sellers =
        sellerBreakdown.map(
            seller => ({

                sellerId:
                    seller.sellerId,

                sellerName:
                    seller.sellerName ||
                    null,

                grossAmount:
                    toMoney(
                        seller.grossAmount
                    ),

                commissionAmount:
                    toMoney(
                        seller.commissionAmount
                    ),

                sellerNet:
                    toMoney(
                        seller.sellerNet
                    ),

                sellerPaymentStatus:
                    seller.sellerPaymentStatus ||
                    null,

                payoutStatus:
                    seller.payoutStatus ||
                    null,

                settlementStatus:
                    seller.settlementStatus ||
                    "NOT_SETTLED",

                sellerPayoutAmount:
                    toMoney(
                        seller.sellerPayoutAmount
                    ),

                settledAt:
                    seller.settledAt ||
                    null,

            })
        );


    return {

        orderId,

        orderStatus:
            order.status ||
            null,

        paymentStatus:
            order.paymentStatus ||
            null,

        fundsHeld:
            order.fundsHeld === true,

        fundsReleased:
            order.fundsReleased === true,

        settlementStatus:
            order.settlementStatus ||
            "NOT_SETTLED",

        settledAt:
            order.settledAt ||
            null,

        sellers,

    };

}


/*
=========================================================
GET SELLER SETTLEMENT
=========================================================
*/

async function getSellerSettlement(
    orderId,
    sellerId
) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const orderSnap =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            )
            .get();


    if (
        !orderSnap.exists
    ) {

        return null;

    }


    const order =
        orderSnap.data();


    const seller =
        getSellerBreakdown(
            order,
            sellerId
        );


    if (
        !seller
    ) {

        return null;

    }


    return {

        orderId,

        sellerId,

        grossAmount:
            toMoney(
                seller.grossAmount
            ),

        commissionAmount:
            toMoney(
                seller.commissionAmount
            ),

        sellerNet:
            toMoney(
                seller.sellerNet
            ),

        sellerPaymentStatus:
            seller.sellerPaymentStatus ||
            null,

        payoutStatus:
            seller.payoutStatus ||
            null,

        settlementStatus:
            seller.settlementStatus ||
            "NOT_SETTLED",

        sellerPayoutAmount:
            toMoney(
                seller.sellerPayoutAmount
            ),

        settledAt:
            seller.settledAt ||
            null,

    };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    settleMarketplaceOrder,

    getSettlementStatus,

    getSellerSettlement,

};