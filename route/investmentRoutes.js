const express = require("express");

const router = express.Router();

const {
  initiateInvestment,
} = require("../controller/investmentController");


/*
=========================================================
INVESTMENT PAYMENT
=========================================================

POST /api/payments/investment

Used by the BIASHNET Investor Portal to initiate
an M-Pesa STK Push.

The frontend should NOT provide userId.

The backend should obtain the authenticated
Firebase user from the Authorization token.
=========================================================
*/

router.post(
  "/investment",
  initiateInvestment
);


module.exports = router;