const express = require("express");

const sellerController =
    require("../controller/sellerController");

const {
    requireAuth
} = require("../middleware/auth");

const {
    sellerAuth
} = require("../middleware/sellerAuth");


const router =
    express.Router();


/*
=========================================================
BIASHNET SELLER ROUTES
=========================================================

BASE:

/api/seller


AUTHENTICATION FLOW:

requireAuth
    ↓
Firebase token verification
    ↓
req.user
    ↓
sellerAuth
    ↓
users/{req.user.uid}
    ↓
verify roles.seller === true
    ↓
req.seller
    ↓
sellerController
=========================================================
*/


/*
=========================================================
SELLER SHOP
=========================================================
*/

router.get(
    "/shop",
    requireAuth,
    sellerAuth,
    sellerController.getShop
);


router.patch(
    "/shop",
    requireAuth,
    sellerAuth,
    sellerController.updateShop
);


/*
=========================================================
SELLER DASHBOARD
=========================================================
*/

router.get(
    "/dashboard",
    requireAuth,
    sellerAuth,
    sellerController.getDashboard
);


router.get(
    "/summary",
    requireAuth,
    sellerAuth,
    sellerController.getSummary
);

/*
=========================================================
SELLER FOLLOWERS
=========================================================
*/

router.get(
    "/:sellerId/follow-status",
    requireAuth,
    sellerController.getFollowStatus
);

router.post(
    "/:sellerId/follow",
    requireAuth,
    sellerController.followSeller
);

router.delete(
    "/:sellerId/follow",
    requireAuth,
    sellerController.unfollowSeller
);

/*
=========================================================
SELLER PRODUCTS
=========================================================
*/

router.get(
    "/products",
    requireAuth,
    sellerAuth,
    sellerController.getProducts
);


router.get(
    "/products/:productId",
    requireAuth,
    sellerAuth,
    sellerController.getProduct
);


router.patch(
    "/products/:productId",
    requireAuth,
    sellerAuth,
    sellerController.updateProduct
);


router.patch(
    "/products/:productId/status",
    requireAuth,
    sellerAuth,
    sellerController.setProductActive
);


router.delete(
    "/products/:productId",
    requireAuth,
    sellerAuth,
    sellerController.deleteProduct
);


/*
=========================================================
SELLER ORDERS
=========================================================
*/

router.get(
    "/orders",
    requireAuth,
    sellerAuth,
    sellerController.getOrders
);


router.get(
    "/orders/:orderId",
    requireAuth,
    sellerAuth,
    sellerController.getOrder
);



/*
=========================================================
EXPORT
=========================================================
*/

module.exports =
    router;