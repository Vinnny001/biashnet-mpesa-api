const {
  processMpesaCallback,
} = require("../service/paymentCallbackService");

const {
  processMpesaB2CCallback,
} = require("../service/withdrawalCallbackService");

const {
  processFinanceB2CCallback,
} = require("../service/financeWithdrawalCallbackService");
/*
=========================================================
WEBHOOK CONTROLLER
=========================================================

Responsibilities:

- Receive Safaricom callbacks
- Pass STK callbacks to paymentCallbackService
- Never perform financial logic directly
- Always acknowledge Safaricom
- Never expose internal errors to Safaricom

STK processing is handled by:

paymentCallbackService.processMpesaCallback()

That service handles:

1. Marketplace payments
2. Old investment payments
3. Wallet deposits
4. Duplicate protection
5. Payment failures
6. Amount verification
7. M-PESA receipt validation
8. Internal processing failures
=========================================================
*/


/*
=========================================================
M-PESA STK CALLBACK
=========================================================

POST

/api/webhooks/mpesa/stk

Safaricom
    ↓
Route
    ↓
Controller
    ↓
processMpesaCallback()
    ↓
Marketplace OR Investment
=========================================================
*/

async function mpesaStkCallback(req, res) {

  try {

    console.log(
      "=========================================="
    );

    console.log(
      "📥 M-PESA STK WEBHOOK RECEIVED"
    );

    console.log(
      "=========================================="
    );


    /*
    -------------------------------------------------------
    PASS CALLBACK TO SERVICE
    -------------------------------------------------------

    IMPORTANT:

    Do not process the payment here.

    The service decides whether this is:

    marketplacePayments
        OR
    pendingTransactions
    */

    const result =
      await processMpesaCallback(
        req.body
      );


    /*
    -------------------------------------------------------
    LOG PROCESSING RESULT
    -------------------------------------------------------
    */

    console.log(
      "📦 M-PESA CALLBACK RESULT:",
      JSON.stringify(
        result,
        null,
        2
      )
    );


    /*
    -------------------------------------------------------
    ALWAYS ACKNOWLEDGE SAFARICOM
    -------------------------------------------------------

    We don't return the internal processing result
    to Safaricom.

    HTTP 200 means:

    "We received your callback."
    */

    return res.sendStatus(200);

  } catch (error) {

    console.error(
      "❌ M-PESA STK webhook controller error:",
      error
    );


    /*
    -------------------------------------------------------
    IMPORTANT
    -------------------------------------------------------

    Never expose internal errors to Safaricom.

    The payment callback service should record the
    processing problem where appropriate.

    We still acknowledge the callback.
    */

    return res.sendStatus(200);

  }

}


/*
=========================================================
M-PESA B2C CALLBACK
=========================================================

POST

/api/webhooks/mpesa/b2c

This is DIFFERENT from STK.

STK:

Customer
   ↓
BIASHNET
   ↓
Safaricom
   ↓
STK Callback

B2C:

BIASHNET
   ↓
Safaricom
   ↓
Customer receives money
   ↓
B2C Result Callback

Therefore DO NOT send B2C through:

processMpesaCallback()

because that service expects:

Body.stkCallback
=========================================================
*/
async function mpesaB2CCallback(req, res) {

  try {

    console.log(
      "=========================================="
    );

    console.log(
      "📥 M-PESA B2C WEBHOOK RECEIVED"
    );

    console.log(
      "=========================================="
    );


    const result =
      await processMpesaB2CCallback(
        req.body
      );


    console.log(
      "📦 B2C CALLBACK RESULT:",
      JSON.stringify(
        result,
        null,
        2
      )
    );


    /*
    IMPORTANT:
    Always acknowledge Safaricom.
    */

    return res.sendStatus(200);

  } catch (error) {

    console.error(
      "❌ M-PESA B2C webhook controller error:",
      error
    );

    return res.sendStatus(200);

  }

}

/*
=========================================================
FINANCE M-PESA B2C CALLBACK
=========================================================

POST

/api/webhooks/mpesa/finance-b2c

Dedicated result URL for Employees/HR/Payroll/Investor
finance withdrawals (see service/financeWithdrawalService.js).
Kept separate from mpesaB2CCallback so the marketplace
seller withdrawal path above is never touched.
=========================================================
*/
async function mpesaFinanceB2CCallback(req, res) {

  try {

    const result = await processFinanceB2CCallback(req.body);

    console.log(
      "📦 FINANCE B2C CALLBACK RESULT:",
      JSON.stringify(result, null, 2)
    );

    return res.sendStatus(200);

  } catch (error) {

    console.error(
      "❌ Finance B2C webhook controller error:",
      error
    );

    return res.sendStatus(200);

  }

}

module.exports = {

  mpesaStkCallback,

  mpesaB2CCallback,

  mpesaFinanceB2CCallback,

};