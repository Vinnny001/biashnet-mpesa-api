const express = require("express");

const router =
    express.Router();


const {
    requireAuth
} = require("../middleware/auth");


const {
    getOrderController,
    getMyOrdersController,
    getSellerOrdersController,
    cancelOrderController,
    removeOrderItemController,
    resolvePartialController,
} = require("../controller/orderController");


/*
=========================================================
ORDER ROUTES
=========================================================

All order routes require Firebase authentication.

Flow:

Android
   ↓
Firebase ID Token
   ↓
requireAuth
   ↓
orderController
   ↓
orderService
   ↓
Firestore
=========================================================
*/


/*
=========================================================
NOTE — ORDER CREATION

No POST / here. Orders are created via
POST /api/payments/checkout (route/checkoutRoutes.js),
the real cart-aware, multi-seller order-creation path.
See controller/orderController.js for the full rationale.
=========================================================
*/


/*
=========================================================
GET MY ORDERS
=========================================================

GET

/api/orders/my
=========================================================
*/

router.get(
    "/my",
    requireAuth,
    getMyOrdersController
);


/*
=========================================================
GET SELLER ORDERS
=========================================================

GET

/api/orders/seller

The seller ID comes from:

req.user.uid
=========================================================
*/

router.get(
    "/seller",
    requireAuth,
    getSellerOrdersController
);


/*
=========================================================
GET SINGLE ORDER
=========================================================

GET

/api/orders/:orderId
=========================================================
*/

router.get(
    "/:orderId",
    requireAuth,
    getOrderController
);


/*
=========================================================
CANCEL ORDER
=========================================================

POST

/api/orders/:orderId/cancel
=========================================================
*/

router.post(
    "/:orderId/cancel",
    requireAuth,
    cancelOrderController
);


/*
=========================================================
REMOVE ITEM FROM AN UNPAID ORDER
=========================================================

DELETE

/api/orders/:orderId/items/:listingId

Buyer-only, only while the order is still unpaid.
=========================================================
*/

router.delete(
    "/:orderId/items/:listingId",
    requireAuth,
    removeOrderItemController
);


/*
=========================================================
RESOLVE PARTIAL FULFILLMENT
=========================================================

POST

/api/orders/:orderId/resolve-partial

Body:

{ "decision": "accept_partial" | "cancel" }

Only usable once the order has been flagged for a buyer
decision after a seller missed their 36h drop-off window.
=========================================================
*/

router.post(
    "/:orderId/resolve-partial",
    requireAuth,
    resolvePartialController
);


module.exports = router;