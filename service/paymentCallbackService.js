const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");

const {
  PAYMENT_STATUS,
} = require("../config/paymentConstants");

const {
  processMarketplacePayment,
  markPaymentFailed,
} = require("./paymentService");

const {
  creditWallet,
} = require("./wallet");

const {
  saveTransaction,
} = require("./transactions");

const {
  createWalletIfNotExists,
} = require("./walletInit");

const {
  syncInvestor,
} = require("./investors");

const {
  updateInvestmentStats,
} = require("./investmentStats");

const {
  recordContribution: recordInvestorContribution,
} = require("./investorLedgerService");

const {
  generateOrderCompletionCode,
} = require("./orderCompletionService");

const {
  createMarketplaceReceipt,
} = require("./receiptService");

const {
  notifyBuyerPaymentSuccess,
  notifyBuyerCompletionCode,
  notifySellersOfPaidOrder,
} = require("./marketplaceNotificationService");
/*
=========================================================
CALLBACK METADATA HELPER
=========================================================
*/

function value(callback, name) {

  return callback
    ?.CallbackMetadata
    ?.Item
    ?.find(item =>
      item.Name === name
    )
    ?.Value;

}


/*
=========================================================
MARKETPLACE CALLBACK
=========================================================
*/

async function marketplaceCallback(
  doc,
  callback,
  resultCode,
  resultDesc
) {

  const ref =
    doc.ref;

  const payment =
    doc.data();


  /*
  =======================================================
  A REPLACED PROMPT REPORTING BACK
  =======================================================

  A stale prompt can be replaced by a fresh one (see
  paymentInitiationService). Its CheckoutRequestID is kept
  in previousCheckoutRequestIDs so a late callback for it
  still lands here, and `superseded` tells the two apart.
  =======================================================
  */

  const superseded =
    Boolean(
      callback?.CheckoutRequestID &&
      payment.checkoutRequestID &&
      callback.CheckoutRequestID !== payment.checkoutRequestID
    );


  /*
  =======================================================
  ALREADY COMPLETED
  =======================================================

  Safaricom retries callbacks, so a repeat of the payment
  that completed this order is normal and ignored. But a
  SUCCESS carrying a different M-Pesa receipt means the
  buyer was charged a second time for the same order —
  possible once prompts can be replaced. That money must
  not vanish silently: it is recorded and flagged for a
  refund.
  =======================================================
  */

  if (
    payment.status ===
    PAYMENT_STATUS.COMPLETED
  ) {

    const lateReceipt =
      value(
        callback,
        "MpesaReceiptNumber"
      );

    if (
      resultCode === 0 &&
      lateReceipt &&
      lateReceipt !== payment.receiptNumber
    ) {

      console.error(
        "🚨 DUPLICATE M-PESA PAYMENT for completed order — refund review needed:",
        payment.orderId,
        lateReceipt
      );

      await ref.update({

        duplicatePayments:
          FieldValue.arrayUnion({
            checkoutRequestID:
              callback.CheckoutRequestID || null,
            receiptNumber:
              lateReceipt,
            amount:
              Number(value(callback, "Amount")) || null,
            phone:
              String(value(callback, "PhoneNumber") || "") || null,
            receivedAt:
              new Date().toISOString(),
          }),

        requiresRefundReview:
          true,

        updatedAt:
          new Date(),

      });

      return {

        handled: true,

        alreadyProcessed: true,

        duplicatePayment: true,

        orderId:
          payment.orderId,

        paymentId:
          payment.paymentId,

      };

    }

    return {

      handled: true,

      alreadyProcessed: true,

      orderId:
        payment.orderId,

      paymentId:
        payment.paymentId,

    };

  }


  /*
  =======================================================
  FAILURE OF A REPLACED PROMPT
  =======================================================

  The old, abandoned prompt finally timing out must NOT
  fail the payment — a fresh prompt is out on the buyer's
  phone right now, and failing it would kill that attempt
  and push the order back. Record it and stop.
  =======================================================
  */

  if (
    resultCode !== 0 &&
    superseded
  ) {

    await ref.update({

      supersededPromptResults:
        FieldValue.arrayUnion({
          checkoutRequestID:
            callback.CheckoutRequestID,
          resultCode,
          resultDesc,
          receivedAt:
            new Date().toISOString(),
        }),

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      superseded: true,

      orderId:
        payment.orderId,

      paymentId:
        payment.paymentId ||
        doc.id,

      resultCode,

      resultDesc,

    };

  }


  /*
  =======================================================
  FAILED / CANCELLED M-PESA PAYMENT
  =======================================================
  */

  if (
    resultCode !== 0
  ) {

    try {

      const result =
        await markPaymentFailed({

          paymentId:
            payment.paymentId ||
            doc.id,

          resultCode,

          resultDescription:
            resultDesc,

          providerResponse:
            callback,

        });

      return {

        handled: true,

        success: false,

        status:
          PAYMENT_STATUS.FAILED,

        orderId:
          payment.orderId,

        paymentId:
          payment.paymentId ||
          doc.id,

        resultCode,

        resultDesc,

        ...result,

      };

    } catch (error) {

      await ref.update({

        callbackProcessingStatus:
          "PROCESSING_FAILED",

        callbackProcessingError:
          error.message,

        resultCode,

        resultDesc,

        providerResponse:
          callback,

        receivedByPlatform:
          true,

        updatedAt:
          new Date(),

      });

      return {

        handled: true,

        requiresReview: true,

        paymentConfirmedByProvider:
          false,

        reason:
          "PAYMENT_FAILURE_PROCESSING_FAILED",

      };

    }

  }


  /*
  =======================================================
  SUCCESS CALLBACK DATA
  =======================================================
  */

  const amount =
    Number(
      value(
        callback,
        "Amount"
      )
    );

  const receipt =
    value(
      callback,
      "MpesaReceiptNumber"
    );

  const phone =
    value(
      callback,
      "PhoneNumber"
    );


  /*
  =======================================================
  RECEIPT VALIDATION
  =======================================================
  */

  if (!receipt) {

    await ref.update({

      callbackProcessingStatus:
        "REQUIRES_REVIEW",

      callbackProcessingError:
        "Missing M-PESA receipt number.",

      providerResponse:
        callback,

      receivedByPlatform:
        true,

      updatedAt:
        new Date(),

    });

    /*
    =====================================================
    IMPORTANT

    Without this return, execution would fall through
    into the post-payment success block below (completion
    code, receipt, "payment succeeded" notification) for a
    payment that was never actually confirmed — the order
    would never be marked PAID/funds held, but the buyer
    would be told it succeeded. See withdrawalCallbackService.js's
    sibling "missing withdrawal ID" branch for the same
    early-return pattern.
    =====================================================
    */

    return {

      handled: true,

      requiresReview: true,

      reason:
        "MISSING_MPESA_RECEIPT",

    };

  }


  /*
  =======================================================
  AMOUNT VALIDATION
  =======================================================
  */

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    await ref.update({

      callbackProcessingStatus:
        "AMOUNT_INVALID",

      callbackAmount:
        amount,

      receiptNumber:
        receipt,

      providerResponse:
        callback,

      receivedByPlatform:
        true,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      reason:
        "INVALID_CALLBACK_AMOUNT",

    };

  }


  /*
  =======================================================
  SERVER-SIDE AMOUNT CHECK
  =======================================================
  */

  const expected =
    Number(
      payment.amount
    );

  if (
    !Number.isFinite(expected) ||
    Math.abs(
      amount - expected
    ) > 0.01
  ) {

    await ref.update({

      callbackProcessingStatus:
        "AMOUNT_MISMATCH",

      callbackAmount:
        amount,

      receiptNumber:
        receipt,

      providerResponse:
        callback,

      receivedByPlatform:
        true,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      reason:
        "PAYMENT_AMOUNT_MISMATCH",

    };

  }


  /*
  =======================================================
  PROCESS MARKETPLACE PAYMENT
  =======================================================

  This is the important hand-off.

  paymentService now performs the atomic
  marketplace payment processing:

  Payment
      ↓
  Order
      ↓
  Stock
      ↓
  Seller funds
  =======================================================
  */

  let result;

  try {

    result =
      await processMarketplacePayment({

        orderId:
          payment.orderId,

        providerTransactionId:
          receipt,

        amount,

        paymentMethod:
          "MPESA",

        providerResponse:
          callback,

      });

  } catch (error) {

    console.error(
      "❌ Marketplace payment processing failed:",
      error
    );

    await ref.update({

      callbackProcessingStatus:
        "PROCESSING_FAILED",

      callbackProcessingError:
        error.message,

      receiptNumber:
        receipt,

      callbackAmount:
        amount,

      callbackPhoneNumber:
        phone || null,

      providerResponse:
        callback,

      receivedByPlatform:
        true,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      paymentConfirmedByProvider:
        true,

      reason:
        "INTERNAL_PROCESSING_FAILED",

    };

  }


  /*
  =======================================================
  SAVE CALLBACK INFORMATION
  =======================================================
  */

  await ref.update({

    status:
      PAYMENT_STATUS.COMPLETED,

    resultCode,

    resultDescription:
      resultDesc,

    receiptNumber:
      receipt,

    callbackAmount:
      amount,

    callbackPhoneNumber:
      phone || null,

    /*
    Keep the payment's CURRENT checkout ID. If a replaced
    prompt is the one that paid, overwriting it with the old
    ID would orphan the fresh prompt: its callback could no
    longer find this payment, so a second charge would be
    lost instead of flagged for refund. The ID that actually
    paid is recorded separately.
    */

    merchantRequestID:
      payment.merchantRequestID ||
      callback.MerchantRequestID ||
      null,

    checkoutRequestID:
      payment.checkoutRequestID ||
      callback.CheckoutRequestID ||
      null,

    paidCheckoutRequestID:
      callback.CheckoutRequestID ||
      null,

    providerResponse:
      callback,

    receivedByPlatform:
      true,

    callbackProcessingStatus:
      "PROCESSED",

    completedAt:
      new Date(),

    updatedAt:
      new Date(),

  });


  /*
  =======================================================
  POST-PAYMENT MARKETPLACE PROCESSING
  =======================================================

  Completion code, buyer receipt, and buyer/seller
  notifications. Skipped when this call's own idempotency
  check above (result.alreadyProcessed) shows the payment
  was already processed by a prior/concurrent delivery of
  the same webhook — otherwise a retried M-Pesa callback
  would regenerate the completion code (invalidating the
  one the buyer already has) and re-send notifications.

  Failures here are logged but never fail the payment —
  the payment is already COMPLETED at this point, and a
  notification/receipt problem must not make it look like
  the payment itself failed.
  =======================================================
  */

  let completionResult;
  let receiptResult;

  if (
    !result?.alreadyProcessed
  ) {

    /*
    =====================================================
    EVERY STEP STANDS ON ITS OWN
    =====================================================

    These steps used to share one try block with the
    completion code first. When the code failed (e.g.
    ORDER_CODE_ENCRYPTION_KEY missing on the server) the
    throw skipped everything after it: no receipt, no
    "payment successful" to the buyer, and no seller was
    ever told to drop off — while their 36-hour drop-off
    window was already running.

    Now each step is attempted independently and failures
    are collected, so one broken step can only ever cost
    its own output. Sellers go first: their deadline is
    the only clock already ticking.

    The payment itself is COMPLETED before any of this
    runs and is never rolled back by a failure here.
    =====================================================
    */

    const failures = [];

    const attempt =
      async (step, run) => {

        try {

          return await run();

        } catch (error) {

          console.error(
            `⚠️ Post-payment step failed [${step}]:`,
            error
          );

          failures.push(
            `${step}: ${error.message}`
          );

          return null;

        }

      };


    const orderSnap =
      await attempt(
        "load order",
        async () => {

          const snap =
            await db
              .collection(COLLECTIONS.ORDERS)
              .doc(payment.orderId)
              .get();

          if (!snap.exists) {

            throw new Error(
              "Order not found after payment processing."
            );

          }

          return snap;

        }
      );

    const order =
      orderSnap
        ? orderSnap.data()
        : null;


    if (order) {

      /*
      One notification per seller, each listing only that
      seller's own items and deadline.
      */

      await attempt(
        "notify sellers",
        () =>
          notifySellersOfPaidOrder({

            orderId:
              payment.orderId,

            order,

          })
      );

      await attempt(
        "notify buyer: payment",
        () =>
          notifyBuyerPaymentSuccess({

            buyerId:
              order.buyerId,

            orderId:
              payment.orderId,

            amount,

            receiptNumber:
              receipt,

          })
      );

    }


    completionResult =
      await attempt(
        "completion code",
        () =>
          generateOrderCompletionCode(
            payment.orderId
          )
      );


    /*
    Only tell the buyer their code is ready if one actually
    exists — previously this was sent unconditionally.
    */

    if (
      order &&
      completionResult
    ) {

      await attempt(
        "notify buyer: code",
        () =>
          notifyBuyerCompletionCode({

            buyerId:
              order.buyerId,

            orderId:
              payment.orderId,

          })
      );

    }


    receiptResult =
      await attempt(
        "receipt",
        () =>
          createMarketplaceReceipt(
            payment.orderId
          )
      );


    /*
    Record only what was actually produced. The old update
    marked the code ACTIVE and wrote a receiptId without
    checking either existed.
    */

    if (
      orderSnap &&
      (receiptResult || completionResult)
    ) {

      await attempt(
        "update order",
        () =>
          orderSnap.ref.update({

            ...(receiptResult
              ? {
                receiptId:
                  receiptResult.receiptId,

                receiptNumber:
                  receipt,
              }
              : {}),

            ...(completionResult
              ? {
                orderCompletionCodeStatus:
                  "ACTIVE",
              }
              : {}),

            updatedAt:
              new Date(),

          })
      );

    }


    if (
      failures.length > 0
    ) {

      /*
      IMPORTANT:
      Payment remains COMPLETED. Same status value and
      field names as before, so anything already reading
      them keeps working — the error now lists every step
      that failed rather than only the first.
      */

      await ref.update({

        callbackProcessingStatus:
          "POST_PAYMENT_PROCESSING_FAILED",

        callbackProcessingError:
          failures.join(" | "),

        receivedByPlatform:
          true,

        updatedAt:
          new Date(),

      }).catch(
        (error) =>
          console.error(
            "⚠️ Could not record post-payment failures:",
            error
          )
      );

    }

  }


  /*
  =======================================================
  SUCCESS
  =======================================================
  */

  return {

    handled: true,

    success: true,

    alreadyProcessed:
      result?.alreadyProcessed ||
      false,

    status:
      PAYMENT_STATUS.COMPLETED,

    orderId:
      payment.orderId,

    paymentId:
      payment.paymentId ||
      doc.id,

    receiptNumber:
      receipt,

    transactionId:
      result?.providerTransactionId ||
      receipt,

    receiptId:
      receiptResult?.receiptId ||
      null,

    completionCodeGenerated:
      Boolean(completionResult),

  };

}

/*
=========================================================
LEGACY INVESTMENT / WALLET CALLBACK
=========================================================
*/

async function investmentCallback(
  checkoutRequestID,
  callback,
  resultCode,
  resultDesc
) {

  /*
  =======================================================
  FIND PENDING INVESTMENT
  =======================================================
  */

  const snapshot =
    await db
      .collection("pendingTransactions")
      .where(
        "checkoutRequestID",
        "==",
        checkoutRequestID
      )
      .limit(1)
      .get();


  /*
  =======================================================
  PAYMENT NOT FOUND
  =======================================================
  */

  if (snapshot.empty) {

    return {

      handled: false,

      reason:
        "UNKNOWN_PAYMENT",

      checkoutRequestID,

    };

  }


  /*
  =======================================================
  GET DOCUMENT
  =======================================================
  */

  const pendingDoc =
    snapshot.docs[0];

  const ref =
    pendingDoc.ref;

  const pending =
    pendingDoc.data();


  /*
  =======================================================
  ALREADY SUCCESSFUL
  =======================================================
  */

  if (
    pending.status ===
    "SUCCESS"
  ) {

    return {

      handled: true,

      alreadyProcessed: true,

      checkoutRequestID,

      userId:
        pending.userId,

      amount:
        pending.amount,

    };

  }

  /*
  =======================================================
  FAILED PAYMENT
  =======================================================
  */

  if (
    resultCode !== 0
  ) {

    await ref.update({

      status:
        "FAILED",

      resultCode,

      resultDesc,

      callback,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      status:
        "FAILED",

    };

  }


  /*
  =======================================================
  PAYMENT DATA
  =======================================================
  */

  const amount =
    Number(
      value(
        callback,
        "Amount"
      )
    ) ||
    Number(
      pending.amount
    );


  const receipt =
    value(
      callback,
      "MpesaReceiptNumber"
    );


  const phone =
    String(
      value(
        callback,
        "PhoneNumber"
      ) ||
      pending.phone ||
      ""
    );


  /*
  =======================================================
  RECEIPT VALIDATION
  =======================================================
  */

  if (!receipt) {

    await ref.update({

      status:
        "REQUIRES_REVIEW",

      callback,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      reason:
        "MISSING_MPESA_RECEIPT",

    };

  }


  /*
  =======================================================
  PROCESS LEGACY INVESTMENT
  =======================================================
  */

  try {

    await createWalletIfNotExists(
      pending.userId,
      phone
    );


    await saveTransaction({

      checkoutRequestID,

      receiptNumber:
        receipt,

      userId:
        pending.userId,

      phone,

      amount,

      type:
        "INVESTMENT",

      status:
        "SUCCESS",

      provider:
        "MPESA",

    });


    await creditWallet({

      userId:
        pending.userId,

      phone,

      amount,

      receiptNumber:
        receipt,

    });


    await syncInvestor(
      pending.userId
    );


    await updateInvestmentStats();


    /*
    =======================================================
    ADDITIVE: FINANCE LEDGER (Employees/HR/Investors/Loans
    domain — see service/investorLedgerService.js)
    =======================================================

    Records this contribution into the new, separate
    financeTransactionRecords ledger and credits a new
    financeWalletAccounts/{investorId} document.

    This does NOT read or write the investor/wallets/
    transactions collections above — it is purely additive
    and wrapped so a failure here can never affect the
    legacy investment flow that already completed.
    =======================================================
    */

    try {

      await recordInvestorContribution({

        investorId:
          pending.userId,

        amount,

        providerTransactionId:
          receipt,

        metadata: {

          checkoutRequestID,

          phone,

        },

      });

    } catch (financeLedgerError) {

      console.error(
        "⚠️ Finance ledger investor contribution recording failed (legacy investment flow unaffected):",
        financeLedgerError
      );

    }


    await ref.update({

      status:
        "SUCCESS",

      receiptNumber:
        receipt,

      resultCode,

      resultDesc,

      callback,

      updatedAt:
        new Date(),

    });


    return {

      handled: true,

      success: true,

      status:
        "SUCCESS",

      userId:
        pending.userId,

      amount,

      receiptNumber:
        receipt,

    };

  } catch (error) {

    console.error(
      "Investment payment processing failed:",
      error
    );


    await ref.update({

      status:
        "PROCESSING_FAILED",

      processingError:
        error.message,

      receiptNumber:
        receipt,

      callback,

      updatedAt:
        new Date(),

    });


    return {

      handled: true,

      requiresReview: true,

      paymentConfirmedByProvider:
        true,

      reason:
        "INVESTMENT_PROCESSING_FAILED",

    };

  }

}

/*
=========================================================
FIND MARKETPLACE PAYMENT
=========================================================

Marketplace payments live in:

COLLECTIONS.PAYMENTS

Uses:

checkoutRequestID
=========================================================
*/

async function findMarketplacePayment(
  checkoutRequestID
) {

  if (!checkoutRequestID) {
    return null;
  }

  const snapshot =
    await db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .where(
        "checkoutRequestID",
        "==",
        checkoutRequestID
      )
      .limit(1)
      .get();

  if (!snapshot.empty) {
    return snapshot.docs[0];
  }

  /*
  A prompt that was replaced by a fresh one keeps its ID in
  previousCheckoutRequestIDs, so its late callback still
  reaches the payment instead of being dropped as unknown.
  Single-field array-contains — no composite index.
  */

  const replaced =
    await db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .where(
        "previousCheckoutRequestIDs",
        "array-contains",
        checkoutRequestID
      )
      .limit(1)
      .get();

  return replaced.empty
    ? null
    : replaced.docs[0];

}


/*
=========================================================
FIND INVESTMENT PAYMENT
=========================================================

Investment STK requests live in:

pendingTransactions

Uses:

checkoutRequestID

=========================================================
*/

async function findInvestmentPayment(
  checkoutRequestID
) {

  if (!checkoutRequestID) {
    return null;
  }

  const snapshot =
    await db
      .collection(
        "pendingTransactions"
      )
      .where(
        "checkoutRequestID",
        "==",
        checkoutRequestID
      )
      .limit(1)
      .get();

  if (snapshot.empty) {
    return null;
  }

  return snapshot.docs[0];

}


/*
=========================================================
MAIN M-PESA CALLBACK
=========================================================
*/

async function processMpesaCallback(
  body
) {

  const callback =
    body?.Body?.stkCallback;

  if (!callback) {

    return {

      handled: false,

      reason:
        "INVALID_CALLBACK",

    };

  }

  const checkoutRequestID =
    callback.CheckoutRequestID;

  const resultCode =
    Number(
      callback.ResultCode
    );

  const resultDesc =
    callback.ResultDesc ||
    "";

  if (!checkoutRequestID) {

    return {

      handled: false,

      reason:
        "MISSING_CHECKOUT_REQUEST_ID",

    };

  }

  console.log(
    "🔥 M-PESA CALLBACK:",
    checkoutRequestID,
    resultCode
  );


  /*
  =======================================================
  1. CHECK MARKETPLACE PAYMENT
  =======================================================
  */

  const marketplaceDoc =
    await findMarketplacePayment(
      checkoutRequestID
    );

  if (marketplaceDoc) {

    console.log(
      "🛒 Marketplace payment found:",
      checkoutRequestID
    );

    return marketplaceCallback(

      marketplaceDoc,

      callback,

      resultCode,

      resultDesc

    );

  }


  /*
  =======================================================
  2. CHECK INVESTMENT PAYMENT
  =======================================================
  */

  const investmentDoc =
    await findInvestmentPayment(
      checkoutRequestID
    );

  if (investmentDoc) {

    console.log(
      "💰 Investment payment found:",
      checkoutRequestID
    );

    return investmentCallback(

      checkoutRequestID,

      callback,

      resultCode,

      resultDesc

    );

  }


  /*
  =======================================================
  3. UNKNOWN PAYMENT
  =======================================================
  */

  console.warn(
    "⚠️ Unknown M-PESA CheckoutRequestID:",
    checkoutRequestID
  );

  return {

    handled: false,

    reason:
      "UNKNOWN_PAYMENT",

    checkoutRequestID,

  };

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  processMpesaCallback,

};