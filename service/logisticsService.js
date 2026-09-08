const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");

const {
    SUB_ORDER_STATUS,
} = require("../config/paymentConstants");

const {
    createNotification,
} = require("./notificationService");


/*
=========================================================
LOGISTICS SERVICE
=========================================================

Sellers no longer hand items directly to buyers. Instead:

Seller
   ↓
delivers item(s) to Biashnet
   ↓
gives the order/sub-order ID to the
Logistics and Supply Chain Manager
   ↓
confirmDropoff()
   ↓
sub-order status: AT_BIASHNET

Funds are NOT released here — this only records that
Biashnet now has physical custody. Release happens once
the whole order resolves (buyer's final completion code,
or the buyer's accept-partial/cancel decision — see
orderService.resolvePartial and
service/complianceSweepService.js).
=========================================================
*/


/* ========================================================
   GET SUB-ORDER
======================================================== */

async function getSubOrder(
    subOrderId
) {

    if (!subOrderId) {

        throw new Error(
            "Sub-order ID is required."
        );

    }

    const snap =
        await db
            .collection(
                COLLECTIONS.SUB_ORDERS
            )
            .doc(
                subOrderId
            )
            .get();

    if (!snap.exists) {

        return null;

    }

    return {

        id:
            snap.id,

        ...snap.data(),

    };

}


/* ========================================================
   CONFIRM DROPOFF
======================================================== */

async function confirmDropoff({

    subOrderId,

    confirmedBy,

}) {

    if (!subOrderId) {

        throw new Error(
            "Sub-order ID is required."
        );

    }

    if (!confirmedBy) {

        throw new Error(
            "Confirming logistics manager ID is required."
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

    let result;

    await db.runTransaction(
        async (transaction) => {

            const snap =
                await transaction.get(
                    subOrderRef
                );

            if (
                !snap.exists
            ) {

                const error =
                    new Error(
                        "Sub-order not found."
                    );

                error.statusCode = 404;

                throw error;

            }

            const subOrder =
                snap.data();

            if (
                subOrder.status ===
                SUB_ORDER_STATUS.AT_BIASHNET
            ) {

                result = {

                    success:
                        true,

                    alreadyConfirmed:
                        true,

                    subOrderId,

                    status:
                        SUB_ORDER_STATUS.AT_BIASHNET,

                };

                return;

            }

            if (
                subOrder.status !==
                SUB_ORDER_STATUS.PENDING_DROPOFF
            ) {

                const error =
                    new Error(
                        `This sub-order cannot be confirmed from status ${subOrder.status}.`
                    );

                error.statusCode = 400;

                throw error;

            }

            transaction.update(

                subOrderRef,

                {

                    status:
                        SUB_ORDER_STATUS.AT_BIASHNET,

                    dropoffConfirmedAt:
                        FieldValue.serverTimestamp(),

                    dropoffConfirmedBy:
                        confirmedBy,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }

            );

            result = {

                success:
                    true,

                alreadyConfirmed:
                    false,

                subOrderId,

                sellerId:
                    subOrder.sellerId,

                orderId:
                    subOrder.orderId,

                status:
                    SUB_ORDER_STATUS.AT_BIASHNET,

            };

        }
    );

    if (
        result &&
        !result.alreadyConfirmed
    ) {

        await createNotification(
            result.sellerId,
            {

                title:
                    "Drop-off confirmed",

                message:
                    `Biashnet has received your item(s) for order ${result.orderId}. Your funds will be released once the buyer confirms delivery.`,

                type:
                    "DROPOFF_CONFIRMED",

                orderId:
                    result.orderId,

            }
        ).catch(
            () => {}
        );

    }

    return result;

}


/* ========================================================
   LIST PENDING DROPOFFS
======================================================== */

async function listPendingDropoffs() {

    const snapshot =
        await db
            .collection(
                COLLECTIONS.SUB_ORDERS
            )
            .where(
                "status",
                "==",
                SUB_ORDER_STATUS.PENDING_DROPOFF
            )
            .get();

    const subOrders =
        snapshot.docs.map(
            (document) => ({

                id:
                    document.id,

                ...document.data(),

            })
        );

    subOrders.sort(
        (a, b) => {

            const getTime =
                (value) =>
                    value?.toMillis
                        ? value.toMillis()
                        : new Date(
                            value || 0
                        ).getTime();

            return (
                getTime(
                    a.dropoffDeadline
                ) -
                getTime(
                    b.dropoffDeadline
                )
            );

        }
    );

    return subOrders;

}


/* ========================================================
   GET SUB-ORDERS FOR ORDER
======================================================== */

async function getSubOrdersForOrder(
    orderId
) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }

    const snapshot =
        await db
            .collection(
                COLLECTIONS.SUB_ORDERS
            )
            .where(
                "orderId",
                "==",
                orderId
            )
            .get();

    return snapshot.docs.map(
        (document) => ({

            id:
                document.id,

            ...document.data(),

        })
    );

}


/* ========================================================
   GET SUB-ORDERS FOR SELLER
======================================================== */

async function getSubOrdersForSeller(
    sellerId
) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }

    const snapshot =
        await db
            .collection(
                COLLECTIONS.SUB_ORDERS
            )
            .where(
                "sellerId",
                "==",
                sellerId
            )
            .get();

    return snapshot.docs.map(
        (document) => ({

            id:
                document.id,

            ...document.data(),

        })
    );

}


module.exports = {

    getSubOrder,

    confirmDropoff,

    listPendingDropoffs,

    getSubOrdersForOrder,

    getSubOrdersForSeller,

};
