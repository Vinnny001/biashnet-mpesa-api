const express = require("express");

const router = express.Router();

const {
  mpesaStkCallback,
  mpesaB2CCallback,
  mpesaFinanceB2CCallback,
} = require("../controller/webhookController");


/*
=========================================================
WEBHOOK ROUTES
=========================================================

These routes are public because Safaricom calls them.

DO NOT use:

- requireAuth
- adminAuth
- sellerAuth

Flow:

Safaricom
    ↓
Webhook Route
    ↓
Webhook Controller
    ↓
Payment Callback Service
    ↓
Marketplace / Investment processing
=========================================================
*/


/*
=========================================================
M-PESA STK CALLBACK
=========================================================

POST

/api/webhooks/mpesa/stk

Handles BOTH:

1. Marketplace payments
2. Old investment / wallet deposits

The paymentCallbackService determines which system
the payment belongs to using CheckoutRequestID.
=========================================================
*/

router.post(
  "/mpesa/stk",
  mpesaStkCallback
);


/*
=========================================================
M-PESA B2C CALLBACK
=========================================================

POST

/api/webhooks/mpesa/b2c

Used for:

- Seller withdrawals
- Wallet withdrawals
- B2C disbursements

This uses a separate B2C callback processor.
=========================================================
*/

router.post(
  "/mpesa/b2c",
  mpesaB2CCallback
);


/*
=========================================================
FINANCE M-PESA B2C CALLBACK
=========================================================

POST

/api/webhooks/mpesa/finance-b2c

Used for:

- Employee stipend withdrawals
- Investor withdrawals

Dedicated result URL so this domain's withdrawals never
touch the marketplace's B2C callback processor above.
=========================================================
*/

router.post(
  "/mpesa/finance-b2c",
  mpesaFinanceB2CCallback
);


module.exports = router;