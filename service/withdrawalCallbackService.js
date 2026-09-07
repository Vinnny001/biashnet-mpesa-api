const {
  db,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");

const {
  PAYOUT_STATUS,
} = require("../config/paymentConstants");

const {
  completeWithdrawal,
  failWithdrawal,
} = require("./withdrawalService");


/*
=========================================================
BIASHNET B2C CALLBACK SERVICE
=========================================================

RESPONSIBILITY

Receives Safaricom B2C callback data and determines:

SUCCESS
    ↓
withdrawalService.completeWithdrawal()

FAILURE
    ↓
withdrawalService.failWithdrawal()

This service does NOT:

- modify wallet balances directly
- initiate B2C
- authenticate sellers
- calculate commission
- settle marketplace orders

=========================================================
*/


/*
=========================================================
MAIN B2C CALLBACK
=========================================================
*/

async function processMpesaB2CCallback(body) {

  /*
  =======================================================
  1. VALIDATE CALLBACK
  =======================================================
  */

  const result =
    body?.Result;


  if (!result) {

    return {

      handled: false,

      reason:
        "INVALID_B2C_CALLBACK",

    };

  }


  /*
  =======================================================
  2. READ RESULT FIELDS
  =======================================================
  */

  const resultCode =
    Number(
      result.ResultCode
    );


  const resultDescription =
    result.ResultDesc ||
    "";


  const originatorConversationId =
    result.OriginatorConversationID ||
    null;


  const conversationId =
    result.ConversationID ||
    null;


  /*
  =======================================================
  3. CALLBACK PARAMETERS
  =======================================================

  Safaricom normally sends:

  ResultParameters
       ↓
  ReferenceData / request identifiers

  We search for useful identifiers.
  =======================================================
  */

  const resultParameters =
    result.ResultParameters
      ?.ResultParameter || [];


  const findParameter =
    (names = []) => {

      const found =
        resultParameters.find(
          item =>
            names.includes(
              item.Key
            )
        );

      return found?.Value ??
        null;

    };


  /*
  =======================================================
  4. IDENTIFY WITHDRAWAL
  =======================================================

  IMPORTANT:

  The best architecture is for your B2C request
  TransactionDesc/QueueTime/Reference field to
  carry withdrawalId.

  We also support TransactionID if your B2C
  implementation stores a mapping.

  =======================================================
  */

  const withdrawalId =
    findParameter([
      "WithdrawalId",
      "withdrawalId",
      "AccountReference",
      "BillReferenceNumber",
      "Reference",
      "TransactionDesc",
    ]);


  /*
  =======================================================
  5. PROVIDER TRANSACTION ID
  =======================================================
  */

  const providerTransactionId =
    result.TransactionID ||
    findParameter([
      "TransactionID",
      "transactionId",
    ]);


  /*
  =======================================================
  6. VALIDATE WITHDRAWAL ID
  =======================================================
  */

  if (!withdrawalId) {

    console.error(
      "❌ B2C callback has no withdrawal ID:",
      JSON.stringify(
        body,
        null,
        2
      )
    );


    return {

      handled: false,

      requiresReview: true,

      reason:
        "MISSING_WITHDRAWAL_ID",

    };

  }


  /*
  =======================================================
  7. SUCCESS
  =======================================================
  */

  if (
    resultCode === 0
  ) {

    const callbackResult =
      await completeWithdrawal({

        withdrawalId,

        transactionId:
          providerTransactionId,

        mpesaReceiptNumber:
          findParameter([
            "TransactionID",
          ]) ||
          providerTransactionId,

        providerResponse:
          body,

      });


    return {

      handled: true,

      success: true,

      withdrawalId,

      status:
        PAYOUT_STATUS.COMPLETED,

      conversationId,

      originatorConversationId,

      providerTransactionId,

      result:
        callbackResult,

    };

  }


  /*
  =======================================================
  8. FAILURE
  =======================================================
  */

  const callbackResult =
    await failWithdrawal({

      withdrawalId,

      reason:
        resultDescription ||
        "M-Pesa B2C withdrawal failed.",

      providerResponse:
        body,

    });


  return {

    handled: true,

    success: false,

    withdrawalId,

    status:
      PAYOUT_STATUS.FAILED,

    resultCode,

    resultDescription,

    conversationId,

    originatorConversationId,

    providerTransactionId,

    result:
      callbackResult,

  };

}


module.exports = {

  processMpesaB2CCallback,

};