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
} = require("../utils/displayName");

const {
  resolveAudience,
} = require("../utils/notificationAudience");


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

Each person is only ever greeted by their OWN name. A
buyer's name, phone or other details never appear in a
notification sent to a seller.
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

  const resolvedType =
    type || "GENERAL";

  /*
  Callers put the audience in data.audience; it is also
  stored top-level so every notification — from either
  writer — carries it in the same place.
  */

  const audience =
    resolveAudience({
      audience: data?.audience,
      type: resolvedType,
    });

  // Account screens are strict — see notificationService.createNotification.
  if (!audience) {
    console.warn(
      `⚠️ Notification "${resolvedType}" for ${userId} has no audience and won't appear on any account's notifications screen.`
    );
  }

  await ref.set({

    notificationId: ref.id,

    userId,

    type: resolvedType,

    audience,

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
    {
      title,
      message,
      data: {
        notificationId: ref.id,
        audience,
        type: resolvedType,
        orderId: data?.orderId,
      },
    }
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
}) {

  /*
  No buyer details: sellers never learn who bought from them.
  Delivery is Biashnet's job, so the order ID is all a seller
  needs to recognise the order.
  */

  const sellerName =
    await getSellerName(sellerId);

  return createNotification({

    userId: sellerId,

    type: "ORDER_OUT_FOR_DELIVERY",

    title: "Order Out For Delivery",

    message:
      `${sellerGreeting(sellerName)} your item(s) for order ${orderId} ` +
      `have left Biashnet and are on the way to the customer. Your ` +
      `funds are released once the customer confirms delivery.`,

    data: {
      orderId,
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

    /*
    Says where the code is rather than including it: a push is
    readable on a locked phone, and this code releases escrow.
    */
    message:
      `${customerGreeting(await getBuyerName(buyerId))} your delivery ` +
      `code for order ${orderId} is the account number in your M-PESA ` +
      `payment message (also on your order page). Only give it to the ` +
      `Biashnet rider after receiving and checking your order.`,

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

Sellers are never told who bought from them — no name,
phone or other buyer detail appears in any seller
notification. Delivery is handled by Biashnet, so a seller
has no need to know the customer.

A seller can still run several orders at once, so each
notification is made recognisable by what the seller
actually has to act on: their own items, which lead the
title (a push banner is often cut down to roughly the
title), plus the order ID, amount and drop-off deadline.
=========================================================
*/

async function notifySellerNewOrder({
  sellerId,
  orderId,
  amount,
  items = [],
  dropoffDeadline = null,
}) {

  const sellerName =
    await getSellerName(sellerId);

  /*
  `items` is THIS seller's slice of the order only — the
  caller passes the seller's own sub-order items. A seller
  must never learn what else the customer bought from other
  shops, and this message is what tells them exactly what
  to bring to the store.
  */

  const itemList =
    describeItems(items);

  const deadline =
    formatDeadline(dropoffDeadline);

  return createNotification({

    userId: sellerId,

    type: "NEW_MARKETPLACE_ORDER",

    title: headlineItem(items)
      ? `New Paid Order: ${headlineItem(items)}`
      : "New Paid Order",

    message:
      `${sellerGreeting(sellerName)} order ${orderId} has been paid` +
      (itemList ? `: ${itemList}` : "") +
      ` (KES ${Number(amount || 0).toLocaleString()}). ` +
      `Please drop off your item(s) at the Biashnet store` +
      (deadline ? ` by ${deadline}.` : "."),

    data: {
      orderId,
      amount,
      dropoffDeadline: deadline,
      audience: "SELLER",
      action: "VIEW_SELLER_ORDER",
    },

  });

}


/*
=========================================================
EVERY SELLER ON A PAID ORDER
=========================================================

One order can hold items from several shops. Each seller
gets their own notification listing only their own items,
amount and drop-off deadline — never the whole order.

The per-seller slice comes from the seller's sub-order,
which the payment transaction creates before this runs.
If an order somehow has none (older records), the slice is
rebuilt from the order itself, still filtered by seller.

Every seller is attempted even if one fails, so a bad
record for one shop can never stop the others being told
to drop off.
=========================================================
*/

async function notifySellersOfPaidOrder({
  orderId,
  order,
}) {

  const subOrders =
    await db
      .collection(COLLECTIONS.SUB_ORDERS)
      .where("orderId", "==", orderId)
      .get();

  let slices =
    subOrders.docs
      .map((doc) => doc.data())
      .filter(
        (subOrder) =>
          subOrder.sellerId &&
          !["CANCELLED", "REFUNDED"].includes(subOrder.status)
      )
      .map((subOrder) => ({
        sellerId: subOrder.sellerId,
        items: subOrder.items || [],
        amount: subOrder.grossAmount || subOrder.sellerGross || 0,
        dropoffDeadline: subOrder.dropoffDeadline || null,
      }));

  if (slices.length === 0) {

    slices =
      (order?.sellerBreakdown || [])
        .filter((seller) => seller.sellerId)
        .map((seller) => ({
          sellerId: seller.sellerId,
          items: (order.items || []).filter(
            (item) => item.sellerId === seller.sellerId
          ),
          amount: seller.grossAmount || seller.sellerGross || 0,
          dropoffDeadline: null,
        }));

  }

  const results =
    await Promise.allSettled(
      slices.map((slice) =>
        notifySellerNewOrder({
          ...slice,
          orderId,
        })
      )
    );

  const failed =
    results.filter((result) => result.status === "rejected");

  if (failed.length > 0) {

    throw new Error(
      `${failed.length} of ${slices.length} seller notification(s) failed: ` +
      failed.map((result) => result.reason?.message).join("; ")
    );

  }

  return {
    notified: slices.length,
  };

}


/*
"Flask ×1" or "Flask ×1 +2 more" — short enough for a
notification title.
*/

function headlineItem(items) {

  const titled =
    (Array.isArray(items) ? items : [])
      .filter((item) => String(item?.title || item?.name || "").trim());

  if (titled.length === 0) {
    return null;
  }

  const first =
    `${String(titled[0].title || titled[0].name).trim()} ×${Number(titled[0].quantity) || 1}`;

  return titled.length > 1
    ? `${first} +${titled.length - 1} more`
    : first;

}


/*
"Flask ×1, Vacuum Cup ×2" — capped so a large order still
fits a push banner.
*/

function describeItems(items) {

  const list =
    (Array.isArray(items) ? items : [])
      .map((item) => {

        const title =
          String(item?.title || item?.name || "").trim();

        if (!title) {
          return null;
        }

        return `${title} ×${Number(item.quantity) || 1}`;

      })
      .filter(Boolean);

  if (list.length <= 3) {

    return list.join(", ");

  }

  return `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`;

}


/*
Deadlines are stored in UTC but read by sellers in Kenya,
and Render runs in UTC — so format explicitly in
Africa/Nairobi rather than trusting the server clock.
*/

function formatDeadline(value) {

  if (!value) {
    return null;
  }

  const date =
    typeof value.toDate === "function"
      ? value.toDate()
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
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

  notifySellersOfPaidOrder,

  notifySellerOutForDelivery,

};