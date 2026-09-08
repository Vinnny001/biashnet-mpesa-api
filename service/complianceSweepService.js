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
    notifySellerNonCompliant,
    notifyBuyerPartialFulfillmentChoice,
} = require("./notificationService");


/*
=========================================================
COMPLIANCE SWEEP SERVICE
=========================================================

Finds sub-orders that missed their 36-hour drop-off
window and are still PENDING_DROPOFF, marks them
NON_COMPLIANT, notifies the seller, and flags the parent
order as needing a buyer decision (accept the available
items, or cancel — see orderService.resolvePartial).

This is called via a stateless HTTP endpoint
(POST /api/internal/compliance-sweep, see
route/internalRoutes.js), NOT an in-process timer — a web
process on most hosts (including Render) isn't guaranteed
to stay running, so scheduling belongs to an external
trigger (a Render Cron Job or a service like
cron-job.org) hitting that endpoint every ~15-30 minutes
with the shared secret header. See that route file's
comments for the exact request shape.
=========================================================
*/

function toMillis(
    value
) {

    if (
        value?.toMillis
    ) {

        return value.toMillis();

    }

    return new Date(
        value || 0
    ).getTime();

}


async function runComplianceSweep() {

    const now =
        Date.now();

    /*
    Single equality filter only — Firestore auto-indexes
    this field, no composite index required. The
    dropoffDeadline comparison happens in JS, same pattern
    already used in service/orderService.js's
    getBuyerOrders() for sorting. This collection stays
    small (only ever contains sub-orders that are still
    PENDING_DROPOFF), so reading the whole set here is
    cheap.
    */

    const pendingSnapshot =
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

    const overdueDocs =
        pendingSnapshot.docs.filter(
            (document) =>
                toMillis(
                    document.data().dropoffDeadline
                ) < now
        );

    const results = {

        checked:
            overdueDocs.length,

        markedNonCompliant:
            [],

        errors:
            [],

    };

    for (
        const document
        of overdueDocs
    ) {

        const subOrder =
            document.data();

        try {

            await document.ref.update({

                status:
                    SUB_ORDER_STATUS.NON_COMPLIANT,

                nonCompliantNotifiedAt:
                    FieldValue.serverTimestamp(),

                updatedAt:
                    FieldValue.serverTimestamp(),

            });

            await notifySellerNonCompliant({

                sellerId:
                    subOrder.sellerId,

                orderId:
                    subOrder.orderId,

            }).catch(
                () => {}
            );

            await flagOrderForCustomerDecision(
                subOrder.orderId
            );

            results.markedNonCompliant.push(
                document.id
            );

        } catch (error) {

            console.error(
                "❌ Compliance sweep failed for sub-order:",
                document.id,
                error
            );

            results.errors.push({

                subOrderId:
                    document.id,

                message:
                    error.message,

            });

        }

    }

    console.log(
        "🕐 COMPLIANCE SWEEP:",
        results
    );

    return results;

}


/* ========================================================
   FLAG ORDER FOR CUSTOMER DECISION
========================================================

Idempotent — safe to call once per non-compliant sub-order
even though only the first call actually needs to notify
the buyer.
======================================================== */

async function flagOrderForCustomerDecision(
    orderId
) {

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            );

    const orderSnap =
        await orderRef.get();

    if (
        !orderSnap.exists
    ) {

        return;

    }

    const order =
        orderSnap.data();

    if (
        order.customerDecisionRequired === true
    ) {

        return;

    }

    await orderRef.update({

        customerDecisionRequired:
            true,

        updatedAt:
            FieldValue.serverTimestamp(),

    });

    const subOrdersSnapshot =
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

    const subOrders =
        subOrdersSnapshot.docs.map(
            (document) =>
                document.data()
        );

    const totalSellerCount =
        subOrders.length;

    const availableSellerCount =
        subOrders.filter(
            (subOrder) =>
                subOrder.status !==
                SUB_ORDER_STATUS.NON_COMPLIANT
        ).length;

    await notifyBuyerPartialFulfillmentChoice({

        buyerId:
            order.buyerId,

        orderId,

        availableSellerCount,

        totalSellerCount,

    }).catch(
        () => {}
    );

}


module.exports = {

    runComplianceSweep,

};
