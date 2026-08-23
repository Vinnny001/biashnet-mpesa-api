const {
  db,
} = require("../config/firebase");

const {
  normalizePhone,
  stkPush,
} = require("./darajaService");


/*
=========================================================
INVESTMENT SERVICE
=========================================================

RESPONSIBILITY:

This service INITIATES an investment payment.

It does NOT process the M-PESA callback.

FLOW:

Controller
    ↓
initiateInvestment()
    ↓
Create pendingTransactions document
    ↓
daraja.stkPush()
    ↓
Safaricom
    ↓
Webhook
    ↓
paymentCallbackService
    ↓
Complete investment
    ↓
transactions
    ↓
wallet
    ↓
investor


=========================================================
*/


async function initiateInvestment({

  userId,

  phone,

  amount,

}) {


  /*
  =======================================================
  1. VALIDATE USER
  =======================================================
  */

  if (!userId) {

    const error =
      new Error(
        "User authentication is required."
      );

    error.statusCode = 401;

    throw error;

  }


  /*
  =======================================================
  2. VERIFY BIASHNET USER
  =======================================================
  */

  const userRef =
    db
      .collection("users")
      .doc(userId);


  const userSnap =
    await userRef.get();


  if (!userSnap.exists) {

    const error =
      new Error(
        "BIASHNET user account not found."
      );

    error.statusCode = 404;

    throw error;

  }


  /*
  =======================================================
  3. VERIFY INVESTOR ACCOUNT
  =======================================================
  */

  const investorRef =
    db
      .collection("investor")
      .doc(userId);


  const investorSnap =
    await investorRef.get();


  if (!investorSnap.exists) {

    const error =
      new Error(
        "Please create an Investor Account before making an investment."
      );

    error.statusCode = 403;

    throw error;

  }


  const investor =
    investorSnap.data();


  /*
  =======================================================
  4. VERIFY INVESTOR STATUS
  =======================================================
  */

  if (
    investor.status ===
    "suspended"
  ) {

    const error =
      new Error(
        "Your Investor Account is currently suspended."
      );

    error.statusCode = 403;

    throw error;

  }


  /*
  =======================================================
  5. VALIDATE AMOUNT
  =======================================================
  */

  const numericAmount =
    Number(amount);


  if (
    !Number.isFinite(
      numericAmount
    ) ||
    numericAmount < 1
  ) {

    const error =
      new Error(
        "Investment amount must be at least KES 1."
      );

    error.statusCode = 400;

    throw error;

  }


  /*
  =======================================================
  6. NORMALIZE PHONE
  =======================================================
  */

  let normalizedPhone;

  try {

    normalizedPhone =
      normalizePhone(phone);

  } catch (error) {

    const validationError =
      new Error(
        error.message ||
        "Invalid Kenyan M-PESA phone number."
      );

    validationError.statusCode = 400;

    throw validationError;

  }


  /*
  =======================================================
  7. CREATE PENDING TRANSACTION
  =======================================================

  IMPORTANT:

  Safaricom has not yet provided a
  CheckoutRequestID.

  Therefore Firestore generates the temporary
  document ID.

  Example:

  pendingTransactions/
      abc123

  Later:

  checkoutRequestID:
      ws_CO_123456789

  =======================================================
  */

  const pendingRef =
    db
      .collection(
        "pendingTransactions"
      )
      .doc();


  const pendingTransactionId =
    pendingRef.id;


  /*
  =======================================================
  8. SAVE PENDING INVESTMENT
  =======================================================
  */

  await pendingRef.set({

    id:
      pendingTransactionId,

    userId,

    phone:
      normalizedPhone,

    amount:
      numericAmount,

    type:
      "INVESTMENT",

    source:
      "INVESTOR_PORTAL",

    status:
      "PENDING",

    provider:
      "MPESA",

    checkoutRequestID:
      null,

    merchantRequestID:
      null,

    responseCode:
      null,

    responseDescription:
      null,

    customerMessage:
      null,

    providerResponse:
      null,

    createdAt:
      new Date(),

    updatedAt:
      new Date(),

  });


  /*
  =======================================================
  9. SEND STK PUSH
  =======================================================
  */

  let stkResponse;

  try {

    stkResponse =
      await stkPush({

        phone:
          normalizedPhone,

        amount:
          numericAmount,

        accountReference:
          `INVEST-${userId}`,

        transactionDesc:
          "BIASHNET Investor Contribution",

      });

  } catch (error) {

    console.error(
      "❌ Investment STK Push failed:",
      error
    );


    /*
    ===============================================
    KEEP THE RECORD FOR AUDIT
    ===============================================
    */

    await pendingRef.update({

      status:
        "STK_FAILED",

      error:
        error.message,

      updatedAt:
        new Date(),

    });


    throw error;

  }


  /*
  =======================================================
  10. EXTRACT SAFARICOM RESPONSE
  =======================================================
  */

  const checkoutRequestID =
    stkResponse?.CheckoutRequestID ||
    null;


  const merchantRequestID =
    stkResponse?.MerchantRequestID ||
    null;


  const responseCode =
    String(
      stkResponse?.ResponseCode ??
      ""
    );


  const responseDescription =
    stkResponse?.ResponseDescription ||
    null;


  const customerMessage =
    stkResponse?.CustomerMessage ||
    null;


  /*
  =======================================================
  11. VALIDATE STK RESPONSE
  =======================================================
  */

  if (
    responseCode !== "0" ||
    !checkoutRequestID
  ) {

    await pendingRef.update({

      status:
        "STK_FAILED",

      responseCode:
        responseCode ||
        null,

      responseDescription,

      customerMessage,

      providerResponse:
        stkResponse,

      updatedAt:
        new Date(),

    });


    const error =
      new Error(
        responseDescription ||
        "M-PESA STK Push could not be initiated."
      );


    error.statusCode =
      502;


    throw error;

  }


  /*
  =======================================================
  12. SAVE SAFARICOM IDENTIFIERS
  =======================================================
  */

  await pendingRef.update({

    checkoutRequestID,

    merchantRequestID,

    responseCode,

    responseDescription,

    customerMessage,

    providerResponse:
      stkResponse,

    status:
      "STK_SENT",

    updatedAt:
      new Date(),

  });


  /*
  =======================================================
  13. RETURN
  =======================================================
  */

  return {

    success: true,

    pendingTransactionId,

    checkoutRequestID,

    merchantRequestID,

    amount:
      numericAmount,

    phone:
      normalizedPhone,

    status:
      "STK_SENT",

    message:
      customerMessage ||
      "M-PESA payment request sent successfully. Check your phone and enter your M-PESA PIN.",

  };

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  initiateInvestment,

};