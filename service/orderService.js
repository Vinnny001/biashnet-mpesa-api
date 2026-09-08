const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");

const {
    ORDER_STATUS,
    PAYMENT_STATUS,
    SELLER_PAYMENT_STATUS,
    PAYOUT_STATUS,
    SUB_ORDER_STATUS,
} = require("../config/paymentConstants");

const {
    hashCompletionCode,
    verifyCompletionCode,
    normalizeCompletionCode,
} = require("../utils/codeGenerator");

const {
    getSubOrdersForOrder,
} = require("./logisticsService");

const {
    releaseSubOrder,
} = require("./subOrderSettlementService");

const {
    createRefund,
} = require("./refundService");

const {
    isProductAvailable,
} = require("./checkoutService");

const {
    money,
} = require("../utils/money");


/*
=========================================================
BIASHNET ORDER SERVICE
=========================================================

RESPONSIBILITIES

1. Read marketplace orders
2. Verify buyer ownership
3. Verify seller ownership
4. Mark payment as initiated
5. Mark order as paid
6. Store payment information
7. Hold seller funds
8. Generate/store completion-code hash
9. Complete order using buyer's completion code
10. Prevent duplicate order completion

IMPORTANT

checkoutService is responsible for:

- validating cart
- validating products
- validating prices
- validating stock availability
- calculating subtotal
- calculating commission
- calculating seller earnings
- creating the initial order

This service therefore does NOT create a second,
different order structure.

PAYMENT SERVICES are responsible for:

- M-Pesa
- payment verification
- payment records
- callbacks

SETTLEMENT SERVICE is responsible for:

- releasing seller funds
- seller wallet credit
- settlement transactions

WITHDRAWAL SERVICE is responsible for:

- seller withdrawal
- M-Pesa B2C
=========================================================
*/


/*
=========================================================
GET ORDER
=========================================================
*/

async function getOrder(orderId) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId)
            .get();


    if (!snapshot.exists) {

        return null;

    }


    return {

        orderId:
            snapshot.id,

        ...snapshot.data(),

    };

}


/*
=========================================================
VERIFY BUYER
=========================================================
*/

async function verifyBuyer({

    order,

    buyerId,

}) {

    if (!order) {

        throw new Error(
            "Order not found."
        );

    }


    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }


    if (
        order.buyerId !==
        buyerId
    ) {

        throw new Error(
            "You are not authorized to access this order."
        );

    }


    return true;

}


/*
=========================================================
VERIFY SELLER
=========================================================
*/

async function verifySeller({

    order,

    sellerId,

}) {

    if (!order) {

        throw new Error(
            "Order not found."
        );

    }


    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    /*
    =====================================================
    IMPORTANT

    checkoutService stores sellerId inside items.

    Therefore:

    Single-seller order:
        order.sellerId

    Multi-seller order:
        order.items[].sellerId

    We support both.
    =====================================================
    */

    if (
        order.sellerId === sellerId
    ) {

        return true;

    }


    if (
        Array.isArray(order.items)
    ) {

        const sellerOwnsItem =
            order.items.some(
                item =>
                    item.sellerId === sellerId
            );


        if (sellerOwnsItem) {

            return true;

        }

    }


    throw new Error(
        "You are not authorized to manage this order."
    );

}


/*
=========================================================
MARK PAYMENT INITIATED
=========================================================

Called by:

paymentInitiationService

AFTER:

- order exists
- buyer owns order
- payment request is accepted by M-Pesa/IntaSend
=========================================================
*/

async function markPaymentInitiated({

    orderId,

    paymentId,

    paymentMethod,

    checkoutRequestId,

    merchantRequestId,

    phoneNumber,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    const orderSnapshot =
        await orderRef.get();


    if (!orderSnapshot.exists) {

        throw new Error(
            "Order not found."
        );

    }


    const order =
        orderSnapshot.data();


    /*
    =====================================================
    PREVENT PAYMENT INITIATION AFTER PAYMENT
    =====================================================
    */

    if (
        order.paymentStatus ===
        PAYMENT_STATUS.COMPLETED
    ) {

        throw new Error(
            "Order has already been paid."
        );

    }


    /*
    =====================================================
    PREVENT PAYMENT INITIATION FOR COMPLETED ORDER
    =====================================================
    */

    if (
        order.status ===
        ORDER_STATUS.COMPLETED
    ) {

        throw new Error(
            "Completed order cannot receive another payment."
        );

    }


    const now =
        FieldValue.serverTimestamp();


    await orderRef.update({

        status:
            ORDER_STATUS.PAYMENT_INITIATED,

        paymentStatus:
            PAYMENT_STATUS.INITIATED,

        paymentId:
            paymentId ||
            null,

        paymentMethod:
            paymentMethod ||
            null,

        checkoutRequestId:
            checkoutRequestId ||
            null,

        merchantRequestId:
            merchantRequestId ||
            null,

        buyerPhone:
            phoneNumber ||
            order.buyerPhone ||
            null,

        paymentInitiatedAt:
            now,

        updatedAt:
            now,

    });


    return getOrder(
        orderId
    );

}


/*
=========================================================
MARK ORDER PAID
=========================================================

IMPORTANT

This function should ONLY be called after:

1. Callback received
2. Callback verified
3. Correct order identified
4. Correct amount verified
5. Duplicate payment check passed

It:

- marks order PAID
- marks payment completed at order level
- marks seller funds HELD
- creates completion-code hash

It does NOT:

- credit seller wallet
- release seller money
- create seller payout

Those belong to settlementService.
=========================================================
*/

async function markOrderPaid({

    orderId,

    paymentId,

    providerTransactionId,

    paymentMethod = "MPESA",

    paidAmount,

    completionCode,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    /*
    =====================================================
    VALIDATE PAYMENT AMOUNT
    =====================================================
    */

    const receivedAmount =
        Number(paidAmount);


    if (
        !Number.isFinite(
            receivedAmount
        ) ||
        receivedAmount <= 0
    ) {

        throw new Error(
            "Invalid paid amount."
        );

    }


    /*
    =====================================================
    GET ORDER
    =====================================================
    */

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    const orderSnapshot =
        await orderRef.get();


    if (!orderSnapshot.exists) {

        throw new Error(
            "Order not found."
        );

    }


    const order =
        orderSnapshot.data();


    /*
    =====================================================
    EXPECTED AMOUNT
    =====================================================
    */

    const expectedAmount =
        Number(
            order.buyerTotal
        );


    if (
        !Number.isFinite(
            expectedAmount
        ) ||
        expectedAmount <= 0
    ) {

        throw new Error(
            "Order has an invalid buyer total."
        );

    }


    /*
    =====================================================
    AMOUNT VERIFICATION
    =====================================================
    */

    if (
        Math.abs(
            expectedAmount -
            receivedAmount
        ) > 0.01
    ) {

        throw new Error(
            `Payment amount mismatch. Expected KES ${expectedAmount}, received KES ${receivedAmount}.`
        );

    }


    /*
    =====================================================
    DUPLICATE CHECK
    =====================================================
    */

    if (
        order.paymentStatus ===
        PAYMENT_STATUS.COMPLETED
    ) {

        return {

            success:
                true,

            alreadyPaid:
                true,

            orderId,

            paymentId:
                order.paymentId ||
                paymentId ||
                null,

            status:
                order.status,

            paymentStatus:
                PAYMENT_STATUS.COMPLETED,

            completionCode:
                null,

            message:
                "Payment has already been processed.",

        };

    }


    /*
    =====================================================
    COMPLETION CODE

    IMPORTANT

    paymentCallbackService should generate the code
    or request this service to generate it.

    This service accepts the plain code and stores
    ONLY the hash.

    If no code is supplied, fail safely.
    =====================================================
    */

    const normalizedCode =
        normalizeCompletionCode(
            completionCode
        );


    if (!normalizedCode) {

        throw new Error(
            "Completion code is required when marking an order as paid."
        );

    }


    const completionCodeHash =
        hashCompletionCode(
            normalizedCode
        );


    const now =
        FieldValue.serverTimestamp();


    /*
    =====================================================
    ATOMIC UPDATE
    =====================================================
    */

    let processed =
        false;


    await db.runTransaction(
        async (transaction) => {

            const freshSnapshot =
                await transaction.get(
                    orderRef
                );


            if (!freshSnapshot.exists) {

                throw new Error(
                    "Order no longer exists."
                );

            }


            const freshOrder =
                freshSnapshot.data();


            /*
            ---------------------------------------------
            DUPLICATE PAYMENT PROTECTION
            ---------------------------------------------
            */

            if (
                freshOrder.paymentStatus ===
                PAYMENT_STATUS.COMPLETED
            ) {

                return;

            }


            /*
            ---------------------------------------------
            DO NOT PAY CANCELLED/REFUNDED ORDERS
            ---------------------------------------------
            */

            if (
                freshOrder.status ===
                ORDER_STATUS.CANCELLED
            ) {

                throw new Error(
                    "Cancelled order cannot be marked as paid."
                );

            }


            if (
                freshOrder.status ===
                ORDER_STATUS.REFUNDED
            ) {

                throw new Error(
                    "Refunded order cannot be marked as paid."
                );

            }


            /*
            ---------------------------------------------
            UPDATE ORDER
            ---------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    status:
                        ORDER_STATUS.PAID,

                    paymentStatus:
                        PAYMENT_STATUS.COMPLETED,

                    paymentId:
                        paymentId ||
                        freshOrder.paymentId ||
                        null,

                    paymentMethod:
                        paymentMethod,

                    providerTransactionId:
                        providerTransactionId ||
                        null,

                    /*
                    -------------------------------------
                    SELLER FUNDS
                    -------------------------------------
                    */

                    fundsReceived:
                        true,

                    fundsHeld:
                        true,

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.HELD,

                    payoutStatus:
                        PAYOUT_STATUS.NOT_RELEASED,

                    /*
                    -------------------------------------
                    COMPLETION CODE
                    -------------------------------------
                    */

                    orderCompletionCodeHash:
                        completionCodeHash,

                    orderCompletionCodeStatus:
                        "ACTIVE",

                    orderCompletionCodeCreatedAt:
                        now,

                    /*
                    -------------------------------------
                    COMPLETION
                    -------------------------------------
                    */

                    orderCompletedAt:
                        null,

                    completedBy:
                        null,

                    /*
                    -------------------------------------
                    PAYMENT TIMESTAMP
                    -------------------------------------
                    */

                    paymentCompletedAt:
                        now,

                    updatedAt:
                        now,

                }

            );


            processed =
                true;

        }
    );


    /*
    =====================================================
    IF ANOTHER CALLBACK ALREADY PROCESSED PAYMENT
    =====================================================
    */

    if (!processed) {

        return {

            success:
                true,

            alreadyPaid:
                true,

            orderId,

            completionCode:
                null,

            message:
                "Payment was already processed.",

        };

    }


    /*
    =====================================================
    RETURN RESULT
    =====================================================

    IMPORTANT:

    The plain completion code is returned ONLY to the
    caller.

    It must NEVER be stored in Firestore.
    =====================================================
    */

    return {

        success:
            true,

        alreadyPaid:
            false,

        orderId,

        paymentId:
            paymentId ||
            null,

        providerTransactionId:
            providerTransactionId ||
            null,

        amount:
            receivedAmount,

        status:
            ORDER_STATUS.PAID,

        paymentStatus:
            PAYMENT_STATUS.COMPLETED,

        sellerPaymentStatus:
            SELLER_PAYMENT_STATUS.HELD,

        payoutStatus:
            PAYOUT_STATUS.NOT_RELEASED,

        completionCode:
            normalizedCode,

        message:
            "Payment successful. Give the completion code to the buyer. The buyer should share it with the seller only after successful delivery.",

    };

}


/*
=========================================================
COMPLETE ORDER WITH BUYER COMPLETION CODE
=========================================================

SELLER FLOW

Seller
   ↓
orderId + completionCode
   ↓
sellerAuth
   ↓
verify seller
   ↓
verify payment
   ↓
verify code
   ↓
ORDER COMPLETED
   ↓
SETTLEMENT SERVICE
   ↓
seller funds released

IMPORTANT:

This function does NOT directly credit the wallet.

The settlement service should perform the financial
release after the order has been atomically completed.
=========================================================
*/

async function completeOrderWithCode({

    orderId,

    sellerId,

    completionCode,

}) {

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


    const normalizedCode =
        normalizeCompletionCode(
            completionCode
        );


    if (
        !normalizedCode
    ) {

        throw new Error(
            "Order completion code is required."
        );

    }


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    /*
    =====================================================
    READ ORDER
    =====================================================
    */

    const orderSnapshot =
        await orderRef.get();


    if (!orderSnapshot.exists) {

        throw new Error(
            "Order not found."
        );

    }


    const order =
        orderSnapshot.data();


    /*
    =====================================================
    VERIFY SELLER
    =====================================================
    */

    await verifySeller({

        order,

        sellerId,

    });


    /*
    =====================================================
    PAYMENT CHECK
    =====================================================
    */

    if (
        order.paymentStatus !==
        PAYMENT_STATUS.COMPLETED
    ) {

        throw new Error(
            "This order has not been successfully paid."
        );

    }


    /*
    =====================================================
    ORDER STATUS CHECK
    =====================================================
    */

    if (
        order.status ===
        ORDER_STATUS.COMPLETED
    ) {

        throw new Error(
            "This order has already been completed."
        );

    }


    /*
    =====================================================
    CODE STATUS CHECK
    =====================================================
    */

    if (
        order.orderCompletionCodeStatus !==
        "ACTIVE"
    ) {

        throw new Error(
            "This order completion code is no longer active."
        );

    }


    /*
    =====================================================
    HASH CHECK
    =====================================================
    */

    if (
        !order.orderCompletionCodeHash
    ) {

        throw new Error(
            "This order does not have a valid completion code."
        );

    }


    /*
    =====================================================
    VERIFY COMPLETION CODE
    =====================================================
    */

    const valid =
        verifyCompletionCode(

            normalizedCode,

            order.orderCompletionCodeHash

        );


    if (!valid) {

        throw new Error(
            "Invalid order completion code."
        );

    }

 /*
    =====================================================
    ATOMIC COMPLETION
    =====================================================
    */

    const now =
        FieldValue.serverTimestamp();


    await db.runTransaction(
        async (transaction) => {

            const freshSnapshot =
                await transaction.get(
                    orderRef
                );


            if (!freshSnapshot.exists) {

                throw new Error(
                    "Order no longer exists."
                );

            }


            const freshOrder =
                freshSnapshot.data();


            /*
            ---------------------------------------------
            RE-CHECK SELLER
            ---------------------------------------------
            */

            const sellerAuthorized =
                freshOrder.sellerId === sellerId ||
                (
                    Array.isArray(
                        freshOrder.items
                    ) &&
                    freshOrder.items.some(
                        item =>
                            item.sellerId ===
                            sellerId
                    )
                );


            if (!sellerAuthorized) {

                throw new Error(
                    "You are not authorized to complete this order."
                );

            }


            /*
            ---------------------------------------------
            RE-CHECK PAYMENT
            ---------------------------------------------
            */

            if (
                freshOrder.paymentStatus !==
                PAYMENT_STATUS.COMPLETED
            ) {

                throw new Error(
                    "Payment is not completed."
                );

            }


            /*
            ---------------------------------------------
            RE-CHECK ORDER
            ---------------------------------------------
            */

            if (
                freshOrder.status ===
                ORDER_STATUS.COMPLETED
            ) {

                throw new Error(
                    "Order has already been completed."
                );

            }


            /*
            ---------------------------------------------
            RE-CHECK CODE
            ---------------------------------------------
            */

            if (
                freshOrder.orderCompletionCodeStatus !==
                "ACTIVE"
            ) {

                throw new Error(
                    "Completion code is no longer active."
                );

            }


            /*
            ---------------------------------------------
            COMPLETE ORDER
            ---------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    status:
                        ORDER_STATUS.COMPLETED,

                    orderCompletionCodeStatus:
                        "USED",

                    orderCompletedAt:
                        now,

                    completedBy:
                        sellerId,

                    /*
                    -------------------------------------
                    SELLER FUNDS

                    We mark them ready for settlement.

                    settlementService performs the actual
                    financial release.
                    -------------------------------------
                    */

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.RELEASED,

                    payoutStatus:
                        PAYOUT_STATUS.PENDING,

                    fundsHeld:
                        false,

                    fundsReceived:
                        true,

                    updatedAt:
                        now,

                }

            );

        }
    );


    /*
    =====================================================
    RETURN RESULT
    =====================================================
    */

    return {

        success:
            true,

        orderId,

        status:
            ORDER_STATUS.COMPLETED,

        completionCodeStatus:
            "USED",

        sellerPaymentStatus:
            SELLER_PAYMENT_STATUS.RELEASED,

        payoutStatus:
            PAYOUT_STATUS.PENDING,

        completedBy:
            sellerId,

        message:
            "Order completed successfully. Seller settlement can now proceed.",

    };

}


/*
=========================================================
GET BUYER ORDER
=========================================================
*/

async function getBuyerOrder({

    orderId,

    buyerId,

}) {

    const order =
        await getOrder(
            orderId
        );


    if (!order) {

        throw new Error(
            "Order not found."
        );

    }


    await verifyBuyer({

        order,

        buyerId,

    });


    /*
    =====================================================
    ITEM AVAILABILITY

    Only relevant while the order is still payable — a
    buyer resuming an unpaid order needs to know which
    items still exist and are purchasable BEFORE they hit
    "Complete Payment" (checkout re-validates this anyway,
    but silently failing there is a bad experience when the
    buyer could just remove the stale item first).
    =====================================================
    */

    const payableStatuses = [

        ORDER_STATUS.PENDING_PAYMENT,

        ORDER_STATUS.PAYMENT_INITIATED,

    ];

    if (
        payableStatuses.includes(order.status) &&
        Array.isArray(order.items) &&
        order.items.length > 0
    ) {

        const productSnapshots =
            await Promise.all(
                order.items.map(
                    (item) =>
                        db
                            .collection(COLLECTIONS.PRODUCTS)
                            .doc(item.listingId)
                            .get()
                )
            );

        order.items =
            order.items.map(
                (item, index) => {

                    const snapshot =
                        productSnapshots[index];

                    const available =
                        snapshot.exists &&
                        isProductAvailable(
                            snapshot.data()
                        );

                    return {

                        ...item,

                        available,

                    };

                }
            );

    }


    return order;

}


/*
=========================================================
REMOVE ITEM FROM AN UNPAID ORDER
=========================================================

Buyers can remove (but not add) items from their own
order while it's still unpaid — e.g. one item turned out
to be unavailable, or they simply changed their mind.
Removing the last remaining item cancels the order
outright rather than leaving an empty payable order
behind. Per-item totals were already computed and stored
by checkoutService at creation time, so this only ever
re-sums what's left — it never re-prices anything.
=========================================================
*/

async function removeOrderItem({

    orderId,

    buyerId,

    listingId,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }

    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }

    if (!listingId) {

        throw new Error(
            "Listing ID is required."
        );

    }


    const orderRef =
        db
            .collection(COLLECTIONS.ORDERS)
            .doc(orderId);


    return db.runTransaction(
        async (transaction) => {

            const snapshot =
                await transaction.get(
                    orderRef
                );

            if (!snapshot.exists) {

                throw new Error(
                    "Order not found."
                );

            }

            const order =
                snapshot.data();

            await verifyBuyer({

                order,

                buyerId,

            });

            const editableStatuses = [

                ORDER_STATUS.PENDING_PAYMENT,

                ORDER_STATUS.PAYMENT_INITIATED,

            ];

            if (
                !editableStatuses.includes(
                    order.status
                )
            ) {

                throw new Error(
                    `This order can no longer be edited. Current status: ${order.status}.`
                );

            }

            const items =
                Array.isArray(order.items)
                    ? order.items
                    : [];

            const itemExists =
                items.some(
                    (item) =>
                        item.listingId ===
                        listingId
                );

            if (!itemExists) {

                throw new Error(
                    "That item is not part of this order."
                );

            }

            const remainingItems =
                items.filter(
                    (item) =>
                        item.listingId !==
                        listingId
                );

            /*
            -------------------------------------------------
            LAST ITEM REMOVED — CANCEL THE ORDER
            -------------------------------------------------
            */

            if (remainingItems.length === 0) {

                const cancelledUpdate = {

                    status:
                        ORDER_STATUS.CANCELLED,

                    items: [],

                    sellerBreakdown: [],

                    sellerIds: [],

                    cancelledAt:
                        FieldValue.serverTimestamp(),

                    cancelReason:
                        "All items removed by buyer before payment.",

                    updatedAt:
                        FieldValue.serverTimestamp(),

                };

                transaction.update(
                    orderRef,
                    cancelledUpdate
                );

                return {

                    orderId,

                    ...cancelledUpdate,

                };

            }


            /*
            -------------------------------------------------
            RE-SUM REMAINING ITEMS
            -------------------------------------------------

            No re-pricing — every remaining item already
            carries the itemTotal/commissionAmount/
            sellerGross/sellerNet checkout computed for it.
            -------------------------------------------------
            */

            const subtotal =
                money(
                    remainingItems.reduce(
                        (sum, item) =>
                            sum + Number(item.itemTotal || 0),
                        0
                    )
                );

            const commissionAmount =
                money(
                    remainingItems.reduce(
                        (sum, item) =>
                            sum + Number(item.commissionAmount || 0),
                        0
                    )
                );

            const sellerGross =
                money(
                    remainingItems.reduce(
                        (sum, item) =>
                            sum + Number(item.sellerGross || 0),
                        0
                    )
                );

            const sellerNet =
                money(
                    remainingItems.reduce(
                        (sum, item) =>
                            sum + Number(item.sellerNet || 0),
                        0
                    )
                );

            const deliveryFee =
                money(
                    order.deliveryFee || 0
                );

            const buyerTotal =
                money(
                    subtotal + deliveryFee
                );


            /*
            -------------------------------------------------
            RE-GROUP SELLER BREAKDOWN

            Sellers with no remaining items are dropped
            entirely; existing seller display fields
            (name/phone/payout status) are preserved from
            the original breakdown.
            -------------------------------------------------
            */

            const bySeller =
                new Map();

            for (
                const item of remainingItems
            ) {

                const key =
                    item.sellerId;

                if (!bySeller.has(key)) {

                    const existing =
                        (order.sellerBreakdown || []).find(
                            (entry) =>
                                entry.sellerId === key
                        );

                    bySeller.set(key, {

                        sellerId: key,

                        sellerName:
                            existing?.sellerName || null,

                        sellerPhone:
                            existing?.sellerPhone || null,

                        grossAmount: 0,

                        commissionAmount: 0,

                        sellerNet: 0,

                        sellerPaymentStatus:
                            existing?.sellerPaymentStatus ||
                            SELLER_PAYMENT_STATUS.NOT_RELEASED,

                        payoutStatus:
                            existing?.payoutStatus ||
                            PAYOUT_STATUS.NOT_RELEASED,

                    });

                }

                const entry =
                    bySeller.get(key);

                entry.grossAmount =
                    money(
                        entry.grossAmount +
                        Number(item.sellerGross || 0)
                    );

                entry.commissionAmount =
                    money(
                        entry.commissionAmount +
                        Number(item.commissionAmount || 0)
                    );

                entry.sellerNet =
                    money(
                        entry.sellerNet +
                        Number(item.sellerNet || 0)
                    );

            }

            const sellerBreakdown =
                Array.from(
                    bySeller.values()
                );

            const sellerIds =
                Array.from(
                    bySeller.keys()
                );

            const update = {

                items: remainingItems,

                subtotal,

                commissionAmount,

                sellerGross,

                sellerNet,

                buyerTotal,

                sellerBreakdown,

                sellerIds,

                updatedAt:
                    FieldValue.serverTimestamp(),

            };

            transaction.update(
                orderRef,
                update
            );

            return {

                orderId,

                ...update,

            };

        }
    );

}


/*
=========================================================
GET ALL BUYER ORDERS
=========================================================

Returns all marketplace orders belonging to the
authenticated buyer.

IMPORTANT:

buyerId MUST come from Firebase Authentication.

The caller must NEVER provide buyerId from:

- req.body
- req.query
- req.params

Supports optional limit.

Example:

getBuyerOrders(
    buyerId,
    {
        limit: 50
    }
)
=========================================================
*/

async function getBuyerOrders(
    buyerId,
    options = {}
) {

    /*
    =====================================================
    VALIDATE BUYER
    =====================================================
    */

    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }


    /*
    =====================================================
    LIMIT
    =====================================================
    */

    let limit =
        Number(
            options.limit || 50
        );


    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {

        limit = 50;

    }


    /*
    * Protect the backend from unnecessarily
    * large requests.
    */

    if (
        limit > 100
    ) {

        limit = 100;

    }


    /*
    =====================================================
    QUERY BUYER ORDERS
    =====================================================
    */

    const snapshot =
        await db
            .collection(
                COLLECTIONS.ORDERS
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


    /*
    =====================================================
    BUILD ORDERS
    =====================================================
    */

    const orders =
        snapshot.docs.map(
            (doc) => {

                const data =
                    doc.data();


                return {

                    id:
                        doc.id,

                    orderId:
                        data.orderId ||
                        doc.id,

                    ...data,

                };

            }
        );


    /*
    =====================================================
    SORT NEWEST FIRST
    =====================================================

    We sort in JavaScript so this remains compatible
    with the current Firestore query and avoids making
    the service dependent on a composite index.
    =====================================================
    */

    orders.sort(
        (a, b) => {

            const getTime =
                (value) => {

                    if (
                        value?.toMillis
                    ) {

                        return value.toMillis();

                    }


                    if (
                        value?.seconds
                    ) {

                        return (
                            Number(
                                value.seconds
                            ) * 1000
                        );

                    }


                    if (
                        value
                    ) {

                        const parsed =
                            new Date(
                                value
                            ).getTime();


                        return Number.isFinite(
                            parsed
                        )
                            ? parsed
                            : 0;

                    }


                    return 0;

                };


            return (
                getTime(
                    b.createdAt
                ) -
                getTime(
                    a.createdAt
                )
            );

        }
    );


    /*
    =====================================================
    RETURN
    =====================================================
    */

    return orders;

}


/*
=========================================================
GET SELLER ORDER
=========================================================
*/

async function getSellerOrder({

    orderId,

    sellerId,

}) {

    const order =
        await getOrder(
            orderId
        );


    if (!order) {

        throw new Error(
            "Order not found."
        );

    }


    await verifySeller({

        order,

        sellerId,

    });


    return order;

}


/*
=========================================================
GET SELLER ORDERS
=========================================================

Lets a seller see which orders contain items belonging to
them — an order can be shared with other sellers (a buyer
can check out 5 items where only 2 belong to this seller),
so both the top-level `items` array and `sellerBreakdown`
(if present) are filtered down to this seller's own entries
before returning. Nothing belonging to another seller
(their items, their share of the sale, their identity) is
exposed.

checkoutService.js writes a `sellerIds` array onto every
order (one entry per seller present in the cart), which is
what this query relies on.
=========================================================
*/

async function getSellerOrders(
    sellerId,
    options = {}
) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    let limit =
        Number(
            options.limit || 50
        );

    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {

        limit = 50;

    }

    if (
        limit > 100
    ) {

        limit = 100;

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .where(
                "sellerIds",
                "array-contains",
                sellerId
            )
            .limit(
                limit
            )
            .get();


    const orders =
        snapshot.docs.map(
            (doc) => {

                const data =
                    doc.data();


                const items =
                    Array.isArray(data.items)
                        ? data.items.filter(
                            (item) =>
                                item.sellerId === sellerId
                        )
                        : [];


                const sellerBreakdown =
                    Array.isArray(data.sellerBreakdown)
                        ? data.sellerBreakdown.filter(
                            (seller) =>
                                seller.sellerId === sellerId
                        )
                        : undefined;


                return {

                    id:
                        doc.id,

                    orderId:
                        data.orderId ||
                        doc.id,

                    buyerId:
                        data.buyerId,

                    status:
                        data.status,

                    paymentStatus:
                        data.paymentStatus,

                    deliveryAddress:
                        data.deliveryAddress,

                    buyerPhone:
                        data.buyerPhone,

                    createdAt:
                        data.createdAt,

                    updatedAt:
                        data.updatedAt,

                    items,

                    ...(sellerBreakdown !== undefined
                        ? { sellerBreakdown }
                        : {}),

                };

            }
        );


    orders.sort(
        (a, b) => {

            const getTime =
                (value) => {

                    if (
                        value?.toMillis
                    ) {

                        return value.toMillis();

                    }


                    if (
                        value?.seconds
                    ) {

                        return (
                            Number(
                                value.seconds
                            ) * 1000
                        );

                    }


                    if (
                        value
                    ) {

                        const parsed =
                            new Date(
                                value
                            ).getTime();


                        return Number.isFinite(
                            parsed
                        )
                            ? parsed
                            : 0;

                    }


                    return 0;

                };


            return (
                getTime(
                    b.createdAt
                ) -
                getTime(
                    a.createdAt
                )
            );

        }
    );


    return orders;

}


/*
=========================================================
CANCEL ORDER
=========================================================

Pre-payment cancellation only. Once an order has moved
past PENDING_PAYMENT/PAYMENT_INITIATED, money may already
be in flight (STK sent, or funds held for a seller) and
cancelling requires refund logic that lives elsewhere
(service/refundService.js) — this function intentionally
refuses to touch those states rather than silently doing
the wrong thing with real money.
=========================================================
*/

const CANCELLABLE_STATUSES = [

    ORDER_STATUS.PENDING_PAYMENT,

    ORDER_STATUS.PAYMENT_INITIATED,

];


async function cancelOrder({

    orderId,

    userId,

    reason = "",

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }

    if (!userId) {

        throw new Error(
            "User ID is required."
        );

    }


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

        const error =
            new Error(
                "Order not found."
            );

        error.statusCode = 404;

        throw error;

    }

    const order =
        orderSnap.data();

    if (
        order.buyerId !== userId
    ) {

        const error =
            new Error(
                "You are not authorized to cancel this order."
            );

        error.statusCode = 403;

        throw error;

    }

    if (
        !CANCELLABLE_STATUSES.includes(
            order.status
        )
    ) {

        const error =
            new Error(
                "This order has already been paid and can no longer be self-cancelled. Contact support for a refund."
            );

        error.statusCode = 400;

        throw error;

    }

    await orderRef.update({

        status:
            ORDER_STATUS.CANCELLED,

        cancelledAt:
            FieldValue.serverTimestamp(),

        cancelReason:
            reason || null,

        updatedAt:
            FieldValue.serverTimestamp(),

    });

    return {

        orderId,

        status:
            ORDER_STATUS.CANCELLED,

    };

}


/*
=========================================================
RESOLVE PARTIAL FULFILLMENT
=========================================================

Called by the buyer once complianceSweepService has
flagged their order (customerDecisionRequired: true)
because at least one seller missed their 36h drop-off
window.

decision === "cancel":
    Full refund via refundService.createRefund. Every
    sub-order is marked CANCELLED. Nothing here was
    released yet (see the delayed-release design in
    subOrderSettlementService.js), so this never needs to
    claw back money from a compliant seller.

decision === "accept_partial":
    Every AT_BIASHNET sub-order is released in full to its
    seller. Every NON_COMPLIANT sub-order is refunded to
    the buyer (partial refund) and marked REFUNDED. Order
    status becomes PARTIALLY_FULFILLED.
=========================================================
*/

async function resolvePartial({

    orderId,

    userId,

    decision,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }

    if (!userId) {

        throw new Error(
            "User ID is required."
        );

    }

    if (
        decision !== "cancel" &&
        decision !== "accept_partial"
    ) {

        throw new Error(
            "Decision must be either \"cancel\" or \"accept_partial\"."
        );

    }

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

        const error =
            new Error(
                "Order not found."
            );

        error.statusCode = 404;

        throw error;

    }

    const order =
        orderSnap.data();

    if (
        order.buyerId !== userId
    ) {

        const error =
            new Error(
                "You are not authorized to resolve this order."
            );

        error.statusCode = 403;

        throw error;

    }

    if (
        order.customerDecisionRequired !== true
    ) {

        const error =
            new Error(
                "This order does not currently require a decision."
            );

        error.statusCode = 400;

        throw error;

    }

    const subOrders =
        await getSubOrdersForOrder(
            orderId
        );

    if (
        decision === "cancel"
    ) {

        const refund =
            await createRefund({

                orderId,

                requestedBy:
                    userId,

                reason:
                    "One or more sellers did not drop off their item(s) within the compliance window; buyer chose to cancel.",

                refundType:
                    "FULL",

            });

        const cancellableStatuses = [

            SUB_ORDER_STATUS.PENDING_DROPOFF,

            SUB_ORDER_STATUS.AT_BIASHNET,

            SUB_ORDER_STATUS.NON_COMPLIANT,

        ];

        await Promise.all(

            subOrders
                .filter(
                    (subOrder) =>
                        cancellableStatuses.includes(
                            subOrder.status
                        )
                )
                .map(
                    (subOrder) =>
                        db
                            .collection(
                                COLLECTIONS.SUB_ORDERS
                            )
                            .doc(
                                subOrder.subOrderId
                            )
                            .update({

                                status:
                                    SUB_ORDER_STATUS.CANCELLED,

                                updatedAt:
                                    FieldValue.serverTimestamp(),

                            })
                )

        );

        await orderRef.update({

            status:
                ORDER_STATUS.CANCELLED,

            customerDecision:
                "cancel",

            customerDecisionMadeAt:
                FieldValue.serverTimestamp(),

            customerDecisionRequired:
                false,

            updatedAt:
                FieldValue.serverTimestamp(),

        });

        return {

            orderId,

            decision:
                "cancel",

            status:
                ORDER_STATUS.CANCELLED,

            refund,

        };

    }


    /*
    =====================================================
    ACCEPT PARTIAL
    =====================================================
    */

    const released =
        [];

    const refunded =
        [];

    for (
        const subOrder
        of subOrders
    ) {

        if (
            subOrder.status ===
            SUB_ORDER_STATUS.AT_BIASHNET
        ) {

            const settled =
                await releaseSubOrder(
                    subOrder.subOrderId
                );

            released.push(
                settled
            );

        } else if (
            subOrder.status ===
            SUB_ORDER_STATUS.NON_COMPLIANT
        ) {

            const refund =
                await createRefund({

                    orderId,

                    requestedBy:
                        userId,

                    reason:
                        `Seller ${subOrder.sellerId} did not drop off their item(s) within the compliance window.`,

                    amount:
                        subOrder.grossAmount,

                    refundType:
                        "PARTIAL",

                });

            await db
                .collection(
                    COLLECTIONS.SUB_ORDERS
                )
                .doc(
                    subOrder.subOrderId
                )
                .update({

                    status:
                        SUB_ORDER_STATUS.REFUNDED,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                });

            refunded.push(
                refund
            );

        }

    }

    await orderRef.update({

        status:
            ORDER_STATUS.PARTIALLY_FULFILLED,

        customerDecision:
            "accept_partial",

        customerDecisionMadeAt:
            FieldValue.serverTimestamp(),

        customerDecisionRequired:
            false,

        updatedAt:
            FieldValue.serverTimestamp(),

    });

    return {

        orderId,

        decision:
            "accept_partial",

        status:
            ORDER_STATUS.PARTIALLY_FULFILLED,

        released,

        refunded,

    };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    /*
    -----------------------------------------------------
    ORDER READ
    -----------------------------------------------------
    */

    getOrder,

    getBuyerOrder,

    getBuyerOrders,

    getSellerOrder,

    getSellerOrders,

    resolvePartial,


    /*
    -----------------------------------------------------
    AUTHORIZATION
    -----------------------------------------------------
    */

    verifyBuyer,

    verifySeller,


    /*
    -----------------------------------------------------
    PAYMENT
    -----------------------------------------------------
    */

    markPaymentInitiated,

    markOrderPaid,


    /*
    -----------------------------------------------------
    COMPLETION
    -----------------------------------------------------
    */

    completeOrderWithCode,


    /*
    -----------------------------------------------------
    CANCELLATION
    -----------------------------------------------------
    */

    cancelOrder,


    /*
    -----------------------------------------------------
    EDITING AN UNPAID ORDER
    -----------------------------------------------------
    */

    removeOrderItem,

};