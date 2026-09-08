const {
    getBuyerOrder,
    getBuyerOrders,
    getSellerOrders,
    cancelOrder,
    resolvePartial,
    removeOrderItem,
} = require("../service/orderService");


/*
=========================================================
ORDER CONTROLLER
=========================================================

Responsibilities:

- Receive HTTP request
- Read authenticated user
- Validate request-level information
- Call orderService
- Return HTTP response

IMPORTANT:

The controller does NOT:

- directly access Firestore
- calculate order totals
- determine seller
- calculate commission
- manipulate stock
- process payments
- release seller funds

Those responsibilities belong to services.
=========================================================
*/


/*
=========================================================
NOTE — ORDER CREATION

There is deliberately no "create single order" endpoint
here. POST /api/payments/checkout (checkoutController.js)
is the real, cart-aware, multi-seller order-creation path
— it's what computes sellerBreakdown/sellerIds that
getSellerOrders below depends on. A second, parallel
single-item order-creation path would immediately drift
from checkout's validation/pricing logic, which is exactly
what orderService.js's own file header already warns
against ("This service therefore does NOT create a second,
different order structure.").
=========================================================
*/


/*
=========================================================
GET SINGLE ORDER
=========================================================

GET

/api/orders/:orderId

Buyer or seller access should ultimately be
verified by orderService.
=========================================================
*/

async function getOrderController(req, res) {

    try {

        const userId =
            req.user?.uid;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        const {
            orderId
        } = req.params;


        if (!orderId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID is required."

            });

        }


        const order =
            await getBuyerOrder({

                orderId,

                buyerId:
                    userId,

            });


        return res.status(200).json({

            success: true,

            order,

        });


    } catch (error) {

        console.error(
            "❌ Get order controller error:",
            error
        );

        const statusCode =
            error.message === "Order not found."
                ? 404
                : error.message?.includes("not authorized")
                    ? 403
                    : 400;

        return res.status(statusCode).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve order.",

        });

    }

}


/*
=========================================================
GET BUYER ORDERS
=========================================================

GET

/api/orders/my
=========================================================
*/

async function getMyOrdersController(req, res) {

    try {

        const buyerId =
            req.user?.uid;


        if (!buyerId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        const orders =
            await getBuyerOrders(
                buyerId,
                {
                    limit:
                        req.query.limit
                }
            );


        return res.status(200).json({

            success: true,

            orders,

            count:
                orders.length,

        });


    } catch (error) {

        console.error(
            "❌ Get buyer orders controller error:",
            error
        );


        return res.status(
            error.statusCode || 400
        ).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve orders.",

        });

    }

}

/*
=========================================================
GET SELLER ORDERS
=========================================================

GET

/api/orders/seller

sellerId comes from Firebase Authentication.
=========================================================
*/

async function getSellerOrdersController(req, res) {

    try {

        const sellerId =
            req.user?.uid;


        if (!sellerId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        const orders =
            await getSellerOrders(
                sellerId
            );


        return res.status(200).json({

            success: true,

            orders,

        });


    } catch (error) {

        console.error(
            "❌ Get seller orders controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve seller orders.",

        });

    }

}


/*
=========================================================
CANCEL ORDER
=========================================================

POST

/api/orders/:orderId/cancel

Authenticated user:

req.user.uid

The user can only cancel an order they are
authorized to cancel.

Reason is optional.
=========================================================
*/

async function cancelOrderController(req, res) {

    try {

        const userId =
            req.user?.uid;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found.",

            });

        }


        const {
            orderId,
        } = req.params;


        if (!orderId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID is required.",

            });

        }


        /*
        * req.body may be undefined when
        * the frontend sends no body.
        */

        const body =
            req.body || {};


        const reason =
            typeof body.reason === "string"
                ? body.reason.trim()
                : "";


        const result =
            await cancelOrder({

                orderId,

                userId,

                reason,

            });


        return res.status(200).json({

            success: true,

            ...result,

        });


    } catch (error) {

        console.error(
            "❌ Cancel order controller error:",
            error
        );


        return res.status(
            error.statusCode || 400
        ).json({

            success: false,

            message:
                error.message ||
                "Unable to cancel order.",

        });

    }

}


/*
=========================================================
REMOVE ITEM FROM AN UNPAID ORDER
=========================================================

DELETE

/api/orders/:orderId/items/:listingId

Buyer-only, and only while the order is still unpaid —
see orderService.removeOrderItem for the full rationale.
=========================================================
*/

async function removeOrderItemController(req, res) {

    try {

        const buyerId =
            req.user?.uid;


        if (!buyerId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found.",

            });

        }


        const {
            orderId,
            listingId,
        } = req.params;


        if (!orderId || !listingId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID and listing ID are required.",

            });

        }


        const result =
            await removeOrderItem({

                orderId,

                buyerId,

                listingId,

            });


        return res.status(200).json({

            success: true,

            ...result,

        });


    } catch (error) {

        console.error(
            "❌ Remove order item controller error:",
            error
        );

        const statusCode =
            error.message === "Order not found."
                ? 404
                : error.message?.includes("not authorized")
                    ? 403
                    : 400;

        return res.status(statusCode).json({

            success: false,

            message:
                error.message ||
                "Unable to remove item from order.",

        });

    }

}


/*
=========================================================
RESOLVE PARTIAL FULFILLMENT
=========================================================

POST

/api/orders/:orderId/resolve-partial

Body:

{
    "decision": "accept_partial" | "cancel"
}

Only valid once the order has been flagged
(customerDecisionRequired: true) by the compliance
sweep because a seller missed their 36h drop-off window.
=========================================================
*/

async function resolvePartialController(req, res) {

    try {

        const userId =
            req.user?.uid;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found.",

            });

        }


        const {
            orderId,
        } = req.params;


        if (!orderId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID is required.",

            });

        }


        const body =
            req.body || {};


        const result =
            await resolvePartial({

                orderId,

                userId,

                decision:
                    body.decision,

            });


        return res.status(200).json({

            success: true,

            ...result,

        });


    } catch (error) {

        console.error(
            "❌ Resolve partial fulfillment controller error:",
            error
        );


        return res.status(
            error.statusCode || 400
        ).json({

            success: false,

            message:
                error.message ||
                "Unable to resolve order.",

        });

    }

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

    getOrderController,

    getMyOrdersController,

    getSellerOrdersController,

    cancelOrderController,

    removeOrderItemController,

    resolvePartialController,

};