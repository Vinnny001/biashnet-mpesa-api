const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");

const {
  sendPush,
} = require("./pushService");

const {
  getBuyerName,
  getSellerName,
  getBuyerIdentity,
} = require("../utils/displayName");


/*
=========================================================
WHO IS BEING SPOKEN TO
=========================================================

Buyer and seller notifications are written in different
voices so the two are never mistaken for each other —
the same order produces "Dear Customer" on one phone and
"Dear Seller" on another, and a person who both buys and
sells on Biashnet sees which hat each message is for.

greet() also personalises when a name is known:

    Dear Customer,              (name unknown)
    Dear Customer Achieng,      (name known)

A missing name degrades to the plain salutation rather
than an empty gap or a raw uid.
=========================================================
*/

function greet(role, name) {

  return name
    ? `Dear ${role} ${name},`
    : `Dear ${role},`;

}


function customerGreeting(name) {

  return greet("Customer", name);

}


function sellerGreeting(name) {

  return greet("Seller", name);

}


/*
Names the other party in a sentence, e.g. "from Achieng",
and collapses to a neutral phrase when unknown.
*/

function party(name, fallback) {

  return name || fallback;

}


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

  sendPush(
    userId,
    { title, message }
  ).catch(
    () => {}
  );

  return {
    notificationId: ref.id,
  };
}


/*
=========================================================
BUYER ORDER PLACED
=========================================================

The first stage of an order, fired at checkout — before
any money has moved. It tells the buyer the order exists
and that it is waiting on payment, so an abandoned or
failed STK push leaves a trace they can come back to
rather than a silently lost basket.

No seller equivalent: an unpaid order owes a seller
nothing, so they are only told once payment lands.
=========================================================
*/

async function notifyBuyerOrderPlaced({
  buyerId,
  orderId,
  itemCount,
  amount,
}) {

  const items =
    Number(itemCount) === 1
      ? "1 item"
      : `${Number(itemCount) || 0} items`;

  const buyerName =
    await getBuyerName(buyerId);

  return createNotification({

    userId: buyerId,

    type: "MARKETPLACE_ORDER_PLACED",

    title: "Order Placed",

    message:
      `${customerGreeting(buyerName)} your order ${orderId} ` +
      `(${items}, KES ${Number(amount || 0).toLocaleString()}) has been ` +
      `placed and is waiting for payment.`,

    data: {
      orderId,
      amount,
      itemCount,
      audience: "BUYER",
      action: "VIEW_ORDER",
    },

  });

}


/*
=========================================================
ORDER OUT FOR DELIVERY — SELLER
=========================================================

The buyer is told by logisticsService when their order
leaves the store. The seller is told too: it is their
confirmation that the item they dropped off is genuinely
on its way out, and the last stage before the buyer's
completion code releases their funds.
=========================================================
*/

async function notifySellerOutForDelivery({
  sellerId,
  orderId,
  buyerId,
}) {

  const [sellerName, buyer] = await Promise.all([
    getSellerName(sellerId),
    getBuyerIdentity(buyerId),
  ]);

  return createNotification({

    userId: sellerId,

    type: "ORDER_OUT_FOR_DELIVERY",

    title: "Order Out For Delivery",

    message:
      `${sellerGreeting(sellerName)} your item(s) for order ${orderId} ` +
      `have left Biashnet and are on the way to ` +
      `${party(buyer.label, "the customer")}. Your funds are released ` +
      `once the customer confirms delivery.`,

    data: {
      orderId,
      buyerName: buyer.label,
      audience: "SELLER",
      action: "VIEW_SELLER_ORDER",
    },

  });

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
      `${customerGreeting(await getBuyerName(buyerId))} your payment of ` +
      `KES ${Number(amount).toLocaleString()} for order ${orderId} ` +
      `was successful.`,

    data: {
      orderId,
      amount,
      receiptNumber,
      audience: "BUYER",
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
      `${customerGreeting(await getBuyerName(buyerId))} your order ` +
      `${orderId} has a delivery completion code. Only give the code to ` +
      `the Biashnet rider after receiving and checking your order.`,

    data: {
      orderId,
      audience: "BUYER",
      action: "VIEW_ORDER",
    },

  });

}


/*
=========================================================
SELLER NEW ORDER
=========================================================

A seller receives orders from many different customers,
often several in a day. Naming the customer is what makes
these distinguishable on a lock screen — otherwise every
one reads identically apart from an order id no human
remembers.

The title carries the name too, because a push banner is
frequently truncated to roughly the title alone.
=========================================================
*/

async function notifySellerNewOrder({
  sellerId,
  orderId,
  amount,
  buyerId,
}) {

  const [sellerName, buyer] = await Promise.all([
    getSellerName(sellerId),
    getBuyerIdentity(buyerId),
  ]);

  return createNotification({

    userId: sellerId,

    type: "NEW_MARKETPLACE_ORDER",

    title: buyer.label
      ? `New Order from ${buyer.label}`
      : "New Order Received",

    message:
      `${sellerGreeting(sellerName)} you have received a new Biashnet ` +
      `order ${orderId} from ${party(buyer.label, "a customer")} worth ` +
      `KES ${Number(amount).toLocaleString()}. Please deliver the item(s) ` +
      `to the Biashnet store for verification.`,

    data: {
      orderId,
      amount,
      buyerName: buyer.label,
      audience: "SELLER",
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

  notifyBuyerOrderPlaced,

  notifyBuyerPaymentSuccess,

  notifyBuyerCompletionCode,

  notifySellerNewOrder,

  notifySellerOutForDelivery,

};