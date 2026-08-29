const express = require("express");

const router =
  express.Router();

const {
  getCompletionCode,
  verifyCompletionCode,
} = require("../controller/orderCompletionController");

const {
  requireAuth,
} = require("../middleware/auth");


/*
=========================================================
BUYER
=========================================================
*/

router.get(
  "/:orderId/code",
  requireAuth,
  getCompletionCode
);


/*
=========================================================
SELLER
=========================================================
*/

router.post(
  "/:orderId/verify",
  requireAuth,
  verifyCompletionCode
);


module.exports = router;