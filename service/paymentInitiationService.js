const { db, FieldValue } = require("../config/firebase");
const { stkPush, queryStkPushStatus } = require("./darajaService");
const { money } = require("../utils/money");
const { reservePaymentReference } = require("../utils/paymentReference");
const { COLLECTIONS } = require("../config/collections");

const {
  PAYMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
} = require("../config/paymentConstants");

function normalizePhone(phone) {
  if (!phone) return "";

  let value = String(phone)
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "");

  if (value.startsWith("+254")) {
    value = value.substring(1);
  }

  if (
    (value.startsWith("07") || value.startsWith("01")) &&
    value.length === 10
  ) {
    value = "254" + value.substring(1);
  }

  return value;
}

function validatePhone(phone) {
  if (!/^254[71]\d{8}$/.test(phone)) {
    throw new Error(
      "Invalid Kenyan M-PESA phone number. Use 07XXXXXXXX, 01XXXXXXXX or 254XXXXXXXXX."
    );
  }
}

/*
========================================================
STALE PROMPT CUTOFF
========================================================

An STK prompt expires on the handset after about a minute.
Three minutes leaves room for a slow network and a buyer
fumbling their PIN, while being long past the point where
the old prompt could still be answered — which is what
makes sending a new one safe from double charging.
========================================================
*/

const STALE_PROMPT_MS = 3 * 60 * 1000;


function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}


/*
Pure policy, so it can be tested without Safaricom.

  prompt younger than the cutoff  -> WAIT (it may still be on the phone)
  Safaricom says PAID             -> AWAIT_CONFIRMATION (never charge twice;
                                     the callback is late, not missing)
  FAILED / PROCESSING / UNKNOWN   -> RESEND (the old prompt can no longer
                                     be answered on the phone)

UNKNOWN resends too: if Safaricom can't even be asked, the
cutoff has still passed, and refusing would leave the buyer
exactly as stuck as before.
*/

function planPendingPrompt({ ageMs, queryState }) {
  if (ageMs < STALE_PROMPT_MS) {
    return { action: "WAIT", reason: "prompt still within the answer window" };
  }

  if (queryState === "PAID") {
    return { action: "AWAIT_CONFIRMATION", reason: "Safaricom reports it paid; callback not yet received" };
  }

  return { action: "RESEND", reason: `stale prompt, Safaricom state ${queryState || "UNKNOWN"}` };
}


async function decideOnPendingPrompt({ payment, checkoutRequestID }) {
  const sentAt =
    toMillis(payment.promptSentAt) ||
    toMillis(payment.updatedAt) ||
    toMillis(payment.createdAt);

  const ageMs =
    sentAt ? Date.now() - sentAt : Number.POSITIVE_INFINITY;

  // Don't bother Safaricom about a prompt that may still be live.
  if (ageMs < STALE_PROMPT_MS) {
    return planPendingPrompt({ ageMs });
  }

  const query =
    await queryStkPushStatus(checkoutRequestID);

  return {
    ...planPendingPrompt({ ageMs, queryState: query.state }),
    query,
  };
}


function generatePaymentId() {
  return `PAY-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase()}`;
}

async function initiateMarketplacePayment({
  orderId,
  buyerId,
  phoneNumber,
  paymentMethod = PAYMENT_METHODS.MPESA,
}) {
  if (!orderId) {
    throw new Error("Order ID is required.");
  }

  if (!buyerId) {
    throw new Error("Buyer ID is required.");
  }

  const method = String(paymentMethod || PAYMENT_METHODS.MPESA)
    .trim()
    .toUpperCase();

  if (method !== PAYMENT_METHODS.MPESA) {
    throw new Error("Currently only M-PESA payments are supported.");
  }

  /*
  ========================================================
  1. GET MARKETPLACE ORDER
  ========================================================
  */

  const orderRef = db
    .collection(COLLECTIONS.ORDERS)
    .doc(orderId);

  const orderSnap = await orderRef.get();

  if (!orderSnap.exists) {
    throw new Error("Marketplace order not found.");
  }

  const order = orderSnap.data();

  /*
  ========================================================
  2. VERIFY BUYER
  ========================================================
  */

  if (order.buyerId !== buyerId) {
    throw new Error(
      "You are not authorized to pay for this order."
    );
  }

  /*
  ========================================================
  3. VERIFY ORDER STATUS
  ========================================================
  */

  if (
    order.paymentStatus === PAYMENT_STATUS.COMPLETED
  ) {
    throw new Error("This order has already been paid.");
  }

  const payableStatuses = [
    ORDER_STATUS.PENDING_PAYMENT,
    ORDER_STATUS.PAYMENT_INITIATED,
  ];

  if (!payableStatuses.includes(order.status)) {
    throw new Error(
      `This order cannot be paid. Current status: ${order.status}.`
    );
  }

  /*
  ========================================================
  4. AUTHORITATIVE AMOUNT
  ========================================================

  Never accept amount from frontend.
  The checkout service already calculated buyerTotal.
  */

  const amount = money(order.buyerTotal);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid marketplace order amount.");
  }

  /*
  ========================================================
  5. PHONE
  ========================================================
  */

  const phone = normalizePhone(
    phoneNumber || order.buyerPhone
  );

  validatePhone(phone);

  /*
  ========================================================
  6. PAYMENT ID
  ========================================================
  */

  const paymentId =
    order.paymentId || generatePaymentId();

  const paymentRef = db
    .collection(COLLECTIONS.PAYMENTS)
    .doc(paymentId);

  /*
  ========================================================
  7. CHECK EXISTING PAYMENT
  ========================================================
  */

  const existingPaymentSnap =
    await paymentRef.get();

  if (existingPaymentSnap.exists) {
    const existingPayment =
      existingPaymentSnap.data();

    const existingCheckoutRequestID =
      existingPayment.checkoutRequestID ||
      existingPayment.checkoutRequestId ||
      null;

    const existingMerchantRequestID =
      existingPayment.merchantRequestID ||
      existingPayment.merchantRequestId ||
      null;

    if (
      existingPayment.status ===
        PAYMENT_STATUS.PENDING &&
      existingCheckoutRequestID
    ) {
      /*
      ======================================================
      A PROMPT IS ALREADY OUT — IS IT REALLY STILL ALIVE?
      ======================================================

      This used to answer "already active, check your
      phone" forever. When Safaricom lost a prompt (it
      stayed at "still under processing", never reached the
      phone, never timed out, never called back) the order
      could never receive another prompt and could never be
      paid.

      Recent prompts are left alone: the buyer may be typing
      their PIN right now. Once one is older than the cutoff
      it can no longer be answered on the handset, so we ask
      Safaricom what happened before deciding.
      ======================================================
      */

      const decision =
        await decideOnPendingPrompt({
          payment: existingPayment,
          checkoutRequestID: existingCheckoutRequestID,
        });

      if (decision.action !== "RESEND") {

        if (decision.action === "AWAIT_CONFIRMATION") {

          await paymentRef.set(
            {
              reconciliation: {
                status: "PAID_PER_SAFARICOM_QUERY",
                checkoutRequestID: existingCheckoutRequestID,
                resultCode: decision.query?.resultCode || null,
                resultDesc: decision.query?.resultDesc || null,
                checkedAt: new Date(),
              },
              requiresReview: true,
              updatedAt: new Date(),
            },
            { merge: true }
          );

        }

        return {
          success: true,
          alreadyInitiated: true,
          paymentId,
          orderId,
          amount,
          currency: "KES",
          phone,
          paymentMethod: PAYMENT_METHODS.MPESA,
          provider: PAYMENT_PROVIDERS.MPESA,
          status: PAYMENT_STATUS.PENDING,
          checkoutRequestID:
            existingCheckoutRequestID,
          merchantRequestID:
            existingMerchantRequestID,
          message:
            decision.action === "AWAIT_CONFIRMATION"
              ? "M-PESA reports this payment as completed. We're waiting for their confirmation to finish your order — please don't pay again."
              : "An M-PESA payment request is already active. Check your phone.",
        };
      }

      console.log(
        `🔁 Replacing stale M-PESA prompt for ${orderId}:`,
        existingCheckoutRequestID,
        decision.reason
      );
    }
  }

  /*
  ========================================================
  8. SEND STK PUSH
  ========================================================
  */

  /*
  The account number in the buyer's M-PESA message, and the
  code they hand the rider on delivery (NNNNN/MM/YY — see
  utils/paymentReference.js). It used to be
  `ORDER-${orderId.slice(0, 8)}`, which came out as
  ORDER-ORD-1789 for every order and was trivially guessable.

  Issued once per order and reused on every resend, so a
  second prompt shows the same number as the first.
  */

  const accountReference =
    (existingPaymentSnap.exists &&
      existingPaymentSnap.data().paymentReference) ||
    await reservePaymentReference({ orderId, paymentId });

  let mpesaResponse;

  try {
    console.log(
      `📲 Sending STK Push: ${orderId} | KES ${amount} | ${phone}`
    );

    mpesaResponse = await stkPush({

    phone,

    amount,

    accountReference,

    transactionDesc:
        "Biashnet order",

});

    console.log(
      "✅ Daraja response:",
      JSON.stringify(mpesaResponse)
    );

  } catch (error) {
    console.error(
      "❌ STK Push error:",
      error.response?.data || error.message
    );

    throw new Error(
      error.response?.data?.errorMessage ||
      error.response?.data?.errorCode ||
      error.message ||
      "Failed to initiate M-PESA payment."
    );
  }

  /*
  ========================================================
  9. VERIFY DARAJA RESPONSE
  ========================================================
  */

  if (
    String(mpesaResponse?.ResponseCode) !== "0"
  ) {
    throw new Error(
      mpesaResponse?.ResponseDescription ||
      "M-PESA STK Push was rejected."
    );
  }

  const checkoutRequestID =
    mpesaResponse.CheckoutRequestID;

  const merchantRequestID =
    mpesaResponse.MerchantRequestID;

  if (!checkoutRequestID) {
    throw new Error(
      "M-PESA did not return a CheckoutRequestID."
    );
  }

  /*
  ========================================================
  10. SAVE PAYMENT
  ========================================================

  IMPORTANT:

  This order can contain multiple sellers.

  Therefore we store sellerIds and items from
  marketplaceOrders instead of sellerId/listingId.
  */

  const now = new Date();

  /*
  A new prompt replaces the order's current checkout ID, but
  the old one is kept. Safaricom callbacks are matched by
  checkout ID, so if a replaced request ever did report
  back — even as paid — it must still find this payment
  rather than arrive as money with no order.
  */

  const previousCheckoutRequestID =
    existingPaymentSnap.exists
      ? existingPaymentSnap.data().checkoutRequestID ||
        existingPaymentSnap.data().checkoutRequestId ||
        null
      : null;

  const supersedes =
    previousCheckoutRequestID &&
    previousCheckoutRequestID !== checkoutRequestID;

  await paymentRef.set(
    {
      ...(supersedes
        ? {
            previousCheckoutRequestIDs:
              FieldValue.arrayUnion(previousCheckoutRequestID),
          }
        : {}),

      promptSentAt: now,

      /*
      Kept on the payment, not the order: order documents are
      read by seller and logistics screens, and this number
      releases escrow. The completion code is derived from it
      after payment and stored encrypted on the order.
      */
      paymentReference: accountReference,

      paymentId,
      orderId,
      buyerId,

      sellerIds: order.sellerIds || [],

      items: order.items || [],

      amount,
      currency: "KES",

      method: PAYMENT_METHODS.MPESA,
      provider: PAYMENT_PROVIDERS.MPESA,
      phone,

      status: PAYMENT_STATUS.PENDING,

      checkoutRequestID,
      merchantRequestID,

      providerResponse: mpesaResponse,

      createdAt:
        existingPaymentSnap.exists
          ? existingPaymentSnap.data().createdAt || now
          : now,

      updatedAt: now,
    },
    { merge: true }
  );

  /*
  ========================================================
  11. UPDATE MARKETPLACE ORDER
  ========================================================
  */

  await orderRef.update({
    paymentId,

    paymentMethod:
      PAYMENT_METHODS.MPESA,

    buyerPhone: phone,

    status:
      ORDER_STATUS.PAYMENT_INITIATED,

    paymentStatus:
      PAYMENT_STATUS.PENDING,

    checkoutRequestID,
    merchantRequestID,

    paymentInitiatedAt: now,
    updatedAt: now,
  });

  /*
  ========================================================
  12. RETURN PAYMENT INFORMATION
  ========================================================
  */

  console.log(
    `✅ PAYMENT INITIATED: ${paymentId}`
  );

  return {
    success: true,
    alreadyInitiated: false,

    paymentId,
    orderId,

    amount,
    currency: "KES",

    phone,

    paymentMethod:
      PAYMENT_METHODS.MPESA,

    provider:
      PAYMENT_PROVIDERS.MPESA,

    status:
      PAYMENT_STATUS.PENDING,

    checkoutRequestID,
    merchantRequestID,

    message:
      mpesaResponse.CustomerMessage ||
      "M-PESA payment request sent. Check your phone and enter your M-PESA PIN.",
  };
}

module.exports = {
  initiateMarketplacePayment,
  planPendingPrompt,
  STALE_PROMPT_MS,
};