const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");


/*
=========================================================
CREATE NOTIFICATION
=========================================================
*/

async function createNotification({
  userId,
  type,
  title,
  message,
  data = {},
}) {

  if (!userId) {
    throw new Error("Notification userId is required.");
  }

  const ref = db
    .collection(COLLECTIONS.NOTIFICATIONS)
    .doc();

  await ref.set({

    notificationId: ref.id,

    userId,

    type: type || "GENERAL",

    title,

    message,

    data,

    read: false,

    createdAt:
      FieldValue.serverTimestamp(),

    updatedAt:
      FieldValue.serverTimestamp(),

  });

  return {
    notificationId: ref.id,
  };
}


/*
=========================================================
BUYER PAYMENT SUCCESS
=========================================================
*/

async function notifyBuyerPaymentSuccess({
  buyerId,
  orderId,
  amount,
  receiptNumber,
}) {

  return createNotification({

    userId: buyerId,

    type: "MARKETPLACE_PAYMENT_SUCCESS",

    title: "Payment Successful",

    message:
      `Your payment of KES ${Number(amount).toLocaleString()} ` +
      `for order ${orderId} was successful.`,

    data: {
      orderId,
      amount,
      receiptNumber,
      action: "VIEW_ORDER",
    },

  });

}


/*
=========================================================
BUYER COMPLETION CODE
=========================================================
*/

async function notifyBuyerCompletionCode({
  buyerId,
  orderId,
}) {

  return createNotification({

    userId: buyerId,

    type: "ORDER_COMPLETION_CODE",

    title: "Your Delivery Code Is Ready",

    message:
      `Your order ${orderId} has a delivery completion code. ` +
      `Only give the code to the seller after receiving and ` +
      `checking your order.`,

    data: {
      orderId,
      action: "VIEW_ORDER",
    },

  });

}


/*
=========================================================
SELLER NEW ORDER
=========================================================
*/

async function notifySellerNewOrder({
  sellerId,
  orderId,
  amount,
}) {

  return createNotification({

    userId: sellerId,

    type: "NEW_MARKETPLACE_ORDER",

    title: "New Order Received",

    message:
      `You have received a new BIASHNET order ${orderId} ` +
      `worth KES ${Number(amount).toLocaleString()}.`,

    data: {
      orderId,
      amount,
      action: "VIEW_SELLER_ORDER",
    },

  });

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  createNotification,

  notifyBuyerPaymentSuccess,

  notifyBuyerCompletionCode,

  notifySellerNewOrder,

};