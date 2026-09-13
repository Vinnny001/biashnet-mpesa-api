const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");

const {
    SUB_ORDER_STATUS,
    ORDER_STATUS,
} = require("../config/paymentConstants");

const {
    createNotification,
} = require("./notificationService");

const {
    notifySellerOutForDelivery,
} = require("./marketplaceNotificationService");

const {
    getBuyerName,
    getBuyerIdentity,
    getSellerIdentity,
} = require("../utils/displayName");


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


/*
=========================================================
ORDER STATUS FOLLOWS SUB-ORDER REALITY
=========================================================

ORDER_STATUS declares PROCESSING, READY_FOR_DELIVERY and
OUT_FOR_DELIVERY, and the buyer's tracker renders all
three, but nothing ever wrote them — an order went from
PAID straight to COMPLETED and the buyer saw no progress
while sellers were actually dropping off.

Drop-off is recorded per seller (one sub-order each), so
the order-level status is derived from them rather than
stored independently:

    a seller still owes a drop-off   -> PROCESSING
    every active seller has dropped  -> READY_FOR_DELIVERY
    logistics dispatches the order   -> OUT_FOR_DELIVERY
    buyer's completion code verified -> COMPLETED

REFUNDED/CANCELLED sub-orders are excluded from "active":
a seller who was refunded out of the order must not hold
the rest of it hostage.

ONLY these three statuses are ever written here, and only
over one another or PAID. Terminal states (COMPLETED,
CANCELLED, REFUNDED, PARTIALLY_FULFILLED) are owned by
orderService/orderCompletionService/complianceSweep and
are never overwritten.
=========================================================
*/

const ORDER_STATUSES_LOGISTICS_MAY_ADVANCE = [

    ORDER_STATUS.PAID,

    ORDER_STATUS.PROCESSING,

    ORDER_STATUS.READY_FOR_DELIVERY,

];


const SUB_ORDER_STATUSES_OUT_OF_PLAY = [

    SUB_ORDER_STATUS.REFUNDED,

    SUB_ORDER_STATUS.CANCELLED,

];


/*
Recomputes an order's delivery status from its sub-orders.

Returns the status the order now holds, or null when it
was left alone (terminal state, or nothing changed).
*/

async function syncOrderDeliveryStatus(
    orderId
) {

    if (!orderId) {

        return null;

    }

    const subOrders =
        await getSubOrdersForOrder(
            orderId
        );

    const active =
        subOrders.filter(
            (subOrder) =>
                !SUB_ORDER_STATUSES_OUT_OF_PLAY.includes(
                    subOrder.status
                )
        );

    if (
        active.length === 0
    ) {

        return null;

    }

    const awaitingDropoff =
        active.some(
            (subOrder) =>
                subOrder.status ===
                SUB_ORDER_STATUS.PENDING_DROPOFF
        );

    const anyAtBiashnet =
        active.some(
            (subOrder) =>
                subOrder.status ===
                SUB_ORDER_STATUS.AT_BIASHNET
        );

    let nextStatus;

    if (
        awaitingDropoff
    ) {

        nextStatus =
            ORDER_STATUS.PROCESSING;

    } else if (
        anyAtBiashnet
    ) {

        nextStatus =
            ORDER_STATUS.READY_FOR_DELIVERY;

    } else {

        /*
        Everything already released or non-compliant —
        that outcome belongs to settlement, not logistics.
        */

        return null;

    }

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            );

    let applied = null;

    await db.runTransaction(
        async (transaction) => {

            const snap =
                await transaction.get(
                    orderRef
                );

            if (!snap.exists) {

                return;

            }

            const current =
                snap.data().status;

            if (
                !ORDER_STATUSES_LOGISTICS_MAY_ADVANCE.includes(
                    current
                )
            ) {

                return;

            }

            if (
                current === nextStatus
            ) {

                applied = nextStatus;

                return;

            }

            transaction.update(
                orderRef,
                {

                    status:
                        nextStatus,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );

            applied = nextStatus;

        }
    );

    return applied;

}


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

                buyerId:
                    subOrder.buyerId,

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

        /*
        Move the order itself along so the buyer's tracker
        reflects the drop-off. Never let a status write
        fail the confirmation that already committed.
        */

        result.orderStatus =
            await syncOrderDeliveryStatus(
                result.orderId
            ).catch(
                () => null
            );

        /*
        Name both parties. The seller runs orders for many
        customers at once, and the buyer's order may have
        several sellers on it — "a seller's item arrived"
        is useless when they are waiting on three.
        */

        const [seller, buyer] =
            await Promise.all([
                getSellerIdentity(result.sellerId),
                getBuyerIdentity(result.buyerId),
            ]);

        const sellerName = seller.name;
        const buyerName = buyer.name;


        await createNotification(
            result.sellerId,
            {

                title:
                    "Drop-off confirmed",

                message:
                    `${sellerName ? `Dear Seller ${sellerName},` : "Dear Seller,"} Biashnet has received your item(s) for order ${result.orderId}${buyer.label ? ` from ${buyer.label}` : ""}. Your funds will be released once the customer confirms delivery.`,

                type:
                    "DROPOFF_CONFIRMED",

                orderId:
                    result.orderId,

            }
        ).catch(
            () => {}
        );

        if (
            result.buyerId
        ) {

            await createNotification(
                result.buyerId,
                {

                    title:
                        seller.label
                            ? `${seller.label} delivered to Biashnet`
                            : "Item arrived at Biashnet",

                    message:
                        `${buyerName ? `Dear Customer ${buyerName},` : "Dear Customer,"} ${seller.label || "a seller"} has delivered their item(s) for your order ${result.orderId} to Biashnet. It'll be sent to you once every seller on the order has dropped off.`,

                    type:
                        "SELLER_DROPOFF_RECEIVED",

                    orderId:
                        result.orderId,

                }
            ).catch(
                () => {}
            );

        }

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
   LIST ORDERS READY FOR DELIVERY
======================================================== */

/*
Orders whose sellers have all dropped off and which are
waiting for logistics to send them out. Driven off the
sub-orders rather than the order status so an order that
predates the status progression still shows up.
*/

async function listReadyForDelivery() {

    const snapshot =
        await db
            .collection(
                COLLECTIONS.SUB_ORDERS
            )
            .where(
                "status",
                "==",
                SUB_ORDER_STATUS.AT_BIASHNET
            )
            .get();

    const byOrderId =
        new Map();

    snapshot.docs.forEach(
        (document) => {

            const subOrder =
                document.data();

            const list =
                byOrderId.get(
                    subOrder.orderId
                ) || [];

            list.push({

                id:
                    document.id,

                ...subOrder,

            });

            byOrderId.set(
                subOrder.orderId,
                list
            );

        }
    );

    if (
        byOrderId.size === 0
    ) {

        return [];

    }

    /*
    An order is only sendable once NO seller on it still
    owes a drop-off, so each candidate order is checked
    against its full sub-order set.
    */

    const orders = [];

    for (
        const [orderId, atBiashnet]
        of byOrderId
    ) {

        const subOrders =
            await getSubOrdersForOrder(
                orderId
            );

        const stillWaiting =
            subOrders.some(
                (subOrder) =>
                    subOrder.status ===
                    SUB_ORDER_STATUS.PENDING_DROPOFF
            );

        if (stillWaiting) {

            continue;

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

        const order =
            orderSnap.exists
                ? orderSnap.data()
                : null;

        if (
            order &&
            !ORDER_STATUSES_LOGISTICS_MAY_ADVANCE.includes(
                order.status
            )
        ) {

            continue;

        }

        orders.push({

            orderId,

            status:
                order?.status || null,

            buyerId:
                order?.buyerId ||
                atBiashnet[0]?.buyerId ||
                null,

            buyerPhone:
                order?.buyerPhone || null,

            deliveryAddress:
                order?.deliveryAddress || null,

            sellerCount:
                atBiashnet.length,

            items:
                atBiashnet.flatMap(
                    (subOrder) =>
                        Array.isArray(subOrder.items)
                            ? subOrder.items
                            : []
                ),

            readySince:
                atBiashnet
                    .map(
                        (subOrder) =>
                            subOrder.dropoffConfirmedAt
                    )
                    .filter(
                        Boolean
                    )
                    .sort(
                        (a, b) => {

                            const time =
                                (value) =>
                                    value?.toMillis
                                        ? value.toMillis()
                                        : 0;

                            return (
                                time(b) -
                                time(a)
                            );

                        }
                    )[0] || null,

        });

    }

    return orders;

}


/* ========================================================
   MARK ORDER OUT FOR DELIVERY
======================================================== */

/*
The dispatch step: Biashnet has every seller's item and a
rider is taking the order to the buyer. This moves no
money — funds are still released only when the buyer's
completion code is verified on handover.
*/

async function markOutForDelivery({

    orderId,

    dispatchedBy,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }

    if (!dispatchedBy) {

        throw new Error(
            "Dispatching logistics manager ID is required."
        );

    }

    const subOrders =
        await getSubOrdersForOrder(
            orderId
        );

    if (
        subOrders.length === 0
    ) {

        const error =
            new Error(
                "No sub-orders found for this order."
            );

        error.statusCode = 404;

        throw error;

    }

    const active =
        subOrders.filter(
            (subOrder) =>
                !SUB_ORDER_STATUSES_OUT_OF_PLAY.includes(
                    subOrder.status
                )
        );

    const stillWaiting =
        active.filter(
            (subOrder) =>
                subOrder.status ===
                SUB_ORDER_STATUS.PENDING_DROPOFF
        );

    if (
        stillWaiting.length > 0
    ) {

        const error =
            new Error(
                `${stillWaiting.length} seller(s) on this order have not dropped off yet.`
            );

        error.statusCode = 400;

        throw error;

    }

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            );

    let result;

    await db.runTransaction(
        async (transaction) => {

            const snap =
                await transaction.get(
                    orderRef
                );

            if (!snap.exists) {

                const error =
                    new Error(
                        "Order not found."
                    );

                error.statusCode = 404;

                throw error;

            }

            const order =
                snap.data();

            if (
                order.status ===
                ORDER_STATUS.OUT_FOR_DELIVERY
            ) {

                result = {

                    success:
                        true,

                    alreadyDispatched:
                        true,

                    orderId,

                    status:
                        ORDER_STATUS.OUT_FOR_DELIVERY,

                };

                return;

            }

            if (
                !ORDER_STATUSES_LOGISTICS_MAY_ADVANCE.includes(
                    order.status
                )
            ) {

                const error =
                    new Error(
                        `This order cannot be sent out for delivery from status ${order.status}.`
                    );

                error.statusCode = 400;

                throw error;

            }

            transaction.update(
                orderRef,
                {

                    status:
                        ORDER_STATUS.OUT_FOR_DELIVERY,

                    dispatchedAt:
                        FieldValue.serverTimestamp(),

                    dispatchedBy,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }
            );

            result = {

                success:
                    true,

                alreadyDispatched:
                    false,

                orderId,

                buyerId:
                    order.buyerId,

                status:
                    ORDER_STATUS.OUT_FOR_DELIVERY,

            };

        }
    );

    if (
        result &&
        !result.alreadyDispatched
    ) {

        if (
            result.buyerId
        ) {

            const buyerName =
                await getBuyerName(
                    result.buyerId
                );

            await createNotification(
                result.buyerId,
                {

                    title:
                        "Your order is on the way",

                    message:
                        `${buyerName ? `Dear Customer ${buyerName},` : "Dear Customer,"} order ${orderId} has left Biashnet and is out for delivery. Have your completion code ready — you'll give it to the rider on handover.`,

                    type:
                        "ORDER_OUT_FOR_DELIVERY",

                    /*
                    ORDER_OUT_FOR_DELIVERY goes to the buyer AND
                    every seller, so the type alone can't say
                    which account this copy belongs to.
                    */
                    audience:
                        "BUYER",

                    orderId,

                }
            ).catch(
                () => {}
            );

        }


        /*
        Every seller on the order hears about it too — one
        notification each, and only to sellers still in the
        order (a refunded or cancelled seller is no longer
        part of this delivery).
        */

        const sellerIds =
            Array.from(
                new Set(
                    active
                        .filter(
                            (subOrder) =>
                                subOrder.sellerId
                        )
                        .map(
                            (subOrder) =>
                                subOrder.sellerId
                        )
                )
            );

        await Promise.all(
            sellerIds.map(
                (sellerId) =>
                    notifySellerOutForDelivery({

                        sellerId,

                        orderId,

                        buyerId:
                            result.buyerId,

                    }).catch(
                        () => {}
                    )
            )
        );

    }

    return result;

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

    listReadyForDelivery,

    markOutForDelivery,

    syncOrderDeliveryStatus,

    getSubOrdersForOrder,

    getSubOrdersForSeller,

};
