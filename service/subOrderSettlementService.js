/*
=========================================================
SUB-ORDER SETTLEMENT SERVICE
=========================================================

Releases a seller's held funds for ONE sub-order. Same
money-math and collection references as
service/settlementService.js, adapted to operate on
marketplaceSubOrders documents instead of the single
embedded sellerBreakdown array — so one seller's payout
no longer depends on every other seller in the order also
being complete (that was the bug in the original design:
settlementService.settleMarketplaceOrder required
order.status === COMPLETED, which the old single
shared-completion-code flow could only ever satisfy for
the FIRST seller to verify).

This service does NOT decide WHEN to release funds — it's
called by:

- orderCompletionService.js, once the buyer's final
  completion code is verified and every sub-order for the
  order is AT_BIASHNET
- orderService.resolvePartial, when the buyer accepts
  partial fulfillment (releases only the compliant
  sub-orders; non-compliant ones are refunded instead via
  service/refundService.js)
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
    SUB_ORDER_STATUS,
    TRANSACTION_TYPES,
} = require("../config/paymentConstants");


/* ========================================================
   MONEY
======================================================== */

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


const COMPANY_WALLET_COLLECTION =
    COLLECTIONS.COMPANY_WALLETS ||
    "companyWallets";

const COMPANY_WALLET_ID =
    "BIASHNET";


/* ========================================================
   RELEASE ONE SUB-ORDER
======================================================== */

async function releaseSubOrder(
    subOrderId
) {

    if (!subOrderId) {

        throw new Error(
            "Sub-order ID is required."
        );

    }

    const subOrderRef =
        db
            .collection(
                COLLECTIONS.SUB_ORDERS
            )
            .doc(
                subOrderId
            );

    const sellerTransactionRef =
        db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                `SETTLEMENT_${subOrderId}`
            );

    const commissionTransactionRef =
        db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                `COMMISSION_SETTLE_${subOrderId}`
            );

    let result;

    await db.runTransaction(
        async (transaction) => {

            const subOrderSnap =
                await transaction.get(
                    subOrderRef
                );

            if (
                !subOrderSnap.exists
            ) {

                throw new Error(
                    "Sub-order not found."
                );

            }

            const subOrder =
                subOrderSnap.data();

            if (
                subOrder.status ===
                SUB_ORDER_STATUS.RELEASED
            ) {

                result = {

                    success:
                        true,

                    alreadyReleased:
                        true,

                    subOrderId,

                    sellerId:
                        subOrder.sellerId,

                };

                return;

            }

            if (
                subOrder.status !==
                SUB_ORDER_STATUS.AT_BIASHNET
            ) {

                throw new Error(

                    `Sub-order ${subOrderId} is not ready for release ` +
                    `(status: ${subOrder.status}). It must be AT_BIASHNET.`

                );

            }

            const sellerNet =
                toMoney(
                    subOrder.sellerNet
                );

            const commissionAmount =
                toMoney(
                    subOrder.commissionAmount
                );

            if (
                sellerNet <= 0
            ) {

                throw new Error(
                    "Invalid sub-order seller net amount."
                );

            }

            const sellerWalletRef =
                db
                    .collection(
                        COLLECTIONS.WALLETS
                    )
                    .doc(
                        subOrder.sellerId
                    );

            const sellerWalletSnap =
                await transaction.get(
                    sellerWalletRef
                );

            const sellerWallet =
                sellerWalletSnap.exists
                    ? sellerWalletSnap.data()
                    : {};

            const sellerPendingBalance =
                toMoney(
                    sellerWallet.pendingBalance
                );

            if (
                sellerPendingBalance <
                sellerNet
            ) {

                throw new Error(

                    `Insufficient held seller funds for sub-order ${subOrderId}. ` +
                    `Pending: KES ${sellerPendingBalance}. Required: KES ${sellerNet}.`

                );

            }

            const companyWalletRef =
                db
                    .collection(
                        COMPANY_WALLET_COLLECTION
                    )
                    .doc(
                        COMPANY_WALLET_ID
                    );

            const companyWalletSnap =
                await transaction.get(
                    companyWalletRef
                );

            const companyWallet =
                companyWalletSnap.exists
                    ? companyWalletSnap.data()
                    : {};

            const sellerTransactionSnap =
                await transaction.get(
                    sellerTransactionRef
                );

            const commissionTransactionSnap =
                commissionAmount > 0
                    ? await transaction.get(
                        commissionTransactionRef
                    )
                    : null;


            /*
            =================================================
            WRITES
            =================================================
            */

            const newSellerPending =
                toMoney(
                    sellerPendingBalance -
                    sellerNet
                );

            const newSellerAvailable =
                toMoney(
                    toMoney(
                        sellerWallet.availableBalance
                    ) +
                    sellerNet
                );

            const newSellerTotalEarned =
                toMoney(
                    toMoney(
                        sellerWallet.totalEarned
                    ) +
                    sellerNet
                );

            transaction.set(

                sellerWalletRef,

                {

                    userId:
                        subOrder.sellerId,

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
                    merge: true,
                }

            );

            if (
                commissionAmount > 0
            ) {

                const newCompanyAvailable =
                    toMoney(
                        toMoney(
                            companyWallet.availableBalance
                        ) +
                        commissionAmount
                    );

                const newCompanyCommission =
                    toMoney(
                        toMoney(
                            companyWallet.totalCommission
                        ) +
                        commissionAmount
                    );

                const newCompanyRevenue =
                    toMoney(
                        toMoney(
                            companyWallet.totalRevenue
                        ) +
                        commissionAmount
                    );

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
                        merge: true,
                    }

                );

            }

            transaction.update(

                subOrderRef,

                {

                    status:
                        SUB_ORDER_STATUS.RELEASED,

                    releasedAt:
                        FieldValue.serverTimestamp(),

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }

            );

            if (
                !sellerTransactionSnap.exists
            ) {

                transaction.create(

                    sellerTransactionRef,

                    {

                        transactionId:
                            `SETTLEMENT_${subOrderId}`,

                        type:
                            TRANSACTION_TYPES.SELLER_PAYOUT,

                        orderId:
                            subOrder.orderId,

                        subOrderId,

                        sellerId:
                            subOrder.sellerId,

                        buyerId:
                            subOrder.buyerId ||
                            null,

                        amount:
                            sellerNet,

                        saleAmount:
                            toMoney(
                                subOrder.grossAmount
                            ),

                        commissionAmount,

                        currency:
                            "KES",

                        status:
                            PAYMENT_STATUS.COMPLETED,

                        direction:
                            "CREDIT",

                        source:
                            "MARKETPLACE_SUB_ORDER",

                        description:
                            `Seller settlement for sub-order ${subOrderId}`,

                        createdAt:
                            FieldValue.serverTimestamp(),

                        completedAt:
                            FieldValue.serverTimestamp(),

                    }

                );

            }

            if (
                commissionAmount > 0 &&
                commissionTransactionSnap &&
                !commissionTransactionSnap.exists
            ) {

                transaction.create(

                    commissionTransactionRef,

                    {

                        transactionId:
                            `COMMISSION_SETTLE_${subOrderId}`,

                        type:
                            TRANSACTION_TYPES.COMMISSION_SETTLEMENT,

                        orderId:
                            subOrder.orderId,

                        subOrderId,

                        sellerId:
                            subOrder.sellerId,

                        buyerId:
                            subOrder.buyerId ||
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
                            "MARKETPLACE_SUB_ORDER",

                        description:
                            `BIASHNET commission for sub-order ${subOrderId}`,

                        createdAt:
                            FieldValue.serverTimestamp(),

                    }

                );

            }

            result = {

                success:
                    true,

                alreadyReleased:
                    false,

                subOrderId,

                orderId:
                    subOrder.orderId,

                sellerId:
                    subOrder.sellerId,

                sellerNet,

                commissionAmount,

            };

        }
    );

    return result;

}


module.exports = {

    releaseSubOrder,

};
