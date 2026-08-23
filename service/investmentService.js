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
  2. VALIDATE INVESTOR
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
  3. VALIDATE AMOUNT
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
        "Minimum investment is KES 1."
      );

    error.statusCode = 400;

    throw error;
  }


  /*
  =======================================================
  4. NORMALIZE PHONE
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
  5. CREATE PENDING TRANSACTION
  =======================================================
  */

  const pendingRef =
    db
      .collection(
        "pendingTransactions"
      )
      .doc();


  const pendingId =
    pendingRef.id;


  await pendingRef.set({

    id:
      pendingId,

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

    createdAt:
      new Date(),

    updatedAt:
      new Date(),

  });


  /*
  =======================================================
  6. SEND STK PUSH
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
  7. READ SAFARICOM RESPONSE
  =======================================================
  */

  const checkoutRequestID =
    stkResponse?.CheckoutRequestID;


  const merchantRequestID =
    stkResponse?.MerchantRequestID;


  const responseCode =
    String(
      stkResponse?.ResponseCode ?? ""
    );


  /*
  =======================================================
  8. STK FAILED
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
        responseCode || null,

      responseDescription:
        stkResponse
          ?.ResponseDescription ||
        null,

      customerMessage:
        stkResponse
          ?.CustomerMessage ||
        null,

      providerResponse:
        stkResponse,

      updatedAt:
        new Date(),

    });


    const error =
      new Error(
        stkResponse
          ?.ResponseDescription ||
        "M-PESA STK Push could not be initiated."
      );

    error.statusCode = 502;

    throw error;
  }


  /*
  =======================================================
  9. SAVE CHECKOUT REQUEST ID
  =======================================================
  */

  await pendingRef.update({

    checkoutRequestID,

    merchantRequestID:
      merchantRequestID ||
      null,

    responseCode,

    responseDescription:
      stkResponse
        ?.ResponseDescription ||
      null,

    customerMessage:
      stkResponse
        ?.CustomerMessage ||
      null,

    providerResponse:
      stkResponse,

    status:
      "STK_SENT",

    updatedAt:
      new Date(),

  });


  /*
  =======================================================
  10. RETURN
  =======================================================
  */

  return {

    success: true,

    pendingTransactionId:
      pendingId,

    checkoutRequestID,

    merchantRequestID:
      merchantRequestID ||
      null,

    amount:
      numericAmount,

    phone:
      normalizedPhone,

    status:
      "STK_SENT",

    message:
      stkResponse
        ?.CustomerMessage ||
      "M-PESA payment request sent successfully.",

  };

}


module.exports = {
  initiateInvestment,
};