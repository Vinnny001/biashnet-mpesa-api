const express = require("express");

const publicSellerController =
    require("../controller/publicSellerController");


const router =
    express.Router();


/*
=========================================================
PUBLIC SELLER ROUTES
=========================================================

BASE:

/api/public/sellers
=========================================================
*/


/*
GET PUBLIC SELLER

/api/public/sellers/:sellerId
*/

router.get(
    "/:sellerId",
    publicSellerController.getPublicSeller
);


/*
GET PUBLIC SELLER PRODUCTS

/api/public/sellers/:sellerId/products
*/

router.get(
    "/:sellerId/products",
    publicSellerController.getPublicSellerProducts
);


module.exports =
    router;