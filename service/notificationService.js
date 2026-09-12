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
SALUTATIONS
=========================================================

Buyers and sellers are addressed differently so the two
never read the same, and a person who is both on Biashnet
can tell at a glance which account a message concerns.
Mirrors marketplaceNotificationService.
=========================================================
*/

async function customerSalutation(buyerId) {

  const name =
    await getBuyerName(buyerId);

  return name
    ? `Dear Customer ${name},`
    : "Dear Customer,";

}


async function sellerSalutation(sellerId) {

  const name =
    await getSellerName(sellerId);

  return name
    ? `Dear Seller ${name},`
    : "Dear Seller,";

}


/*
=========================================================
BIASHNET NOTIFICATION SERVICE
=========================================================

Creates notifications for:

BUYERS
SELLERS
ADMINS

Notifications are stored in:

COLLECTIONS.NOTIFICATIONS

=========================================================
*/


/*
=========================================================
CREATE NOTIFICATION
=========================================================
*/

async function createNotification(
  userId,
  data = {}
) {

  if (!userId) {

    throw new Error(
      "Notification userId is required."
    );

  }


  if (!data.title) {

    throw new Error(
      "Notification title is required."
    );

  }


  if (!data.message) {

    throw new Error(
      "Notification message is required."
    );

  }


  const notificationRef =
    db
      .collection(
        COLLECTIONS.NOTIFICATIONS
      )
      .doc();


  await notificationRef.set({

    notificationId:
      notificationRef.id,

    userId,

    title:
      data.title,

    message:
      data.message,

    type:
      data.type || "GENERAL",

    orderId:
      data.orderId || null,

    paymentId:
      data.paymentId || null,

    read:
      false,

    createdAt:
      FieldValue.serverTimestamp(),

  });


  sendPush(
    userId,
    {
      title: data.title,
      message: data.message,
    }
  ).catch(
    () => {}
  );


  return {

    success: true,

    notificationId:
      notificationRef.id,

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

  paymentId,

  amount,

  receiptNumber,

}) {

  return createNotification(

    buyerId,

    {

      title:
        "Payment Successful",

      message:
        `Your payment of KES ${Number(amount).toLocaleString()} for order ${orderId} was successful. M-PESA receipt: ${receiptNumber}.`,

      type:
        "PAYMENT_SUCCESS",

      orderId,

      paymentId,

    }

  );

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

  return createNotification(

    sellerId,

    {

      title:
        "New Marketplace Order",

      message:
        `You have received a new paid order ${orderId} worth KES ${Number(amount).toLocaleString()}. Open your seller dashboard to fulfill it.`,

      type:
        "NEW_ORDER",

      orderId,

    }

  );

}


/*
=========================================================
BUYER ORDER COMPLETED
=========================================================
*/

async function notifyBuyerOrderCompleted({

  buyerId,

  orderId,

}) {

  return createNotification(

    buyerId,

    {

      title:
        "Order Completed",

      message:
        `${await customerSalutation(buyerId)} your order ${orderId} has been completed successfully. Thank you for shopping with Biashnet.`,

      type:
        "ORDER_COMPLETED",

      orderId,

    }

  );

}


/*
=========================================================
SELLER ORDER COMPLETED
=========================================================
*/

async function notifySellerOrderCompleted({

  sellerId,

  orderId,

  amount,

  buyerId,

}) {

  /*
  .label, not .name — this identifies the customer TO the
  seller, so an email handle is an acceptable last resort
  here in a way it never is in a salutation.
  */

  const buyerName =
    (await getBuyerIdentity(buyerId)).label;

  return createNotification(

    sellerId,

    {

      title:
        "Funds Released",

      message:
        `${await sellerSalutation(sellerId)} order ${orderId}${buyerName ? ` from ${buyerName}` : ""} has been completed and your seller funds of KES ${Number(amount).toLocaleString()} have been released to your wallet.`,

      type:
        "FUNDS_RELEASED",

      orderId,

    }

  );

}


/*
=========================================================
SELLER DROP-OFF REMINDER / NON-COMPLIANT
=========================================================
*/

async function notifySellerNonCompliant({

  sellerId,

  orderId,

}) {

  return createNotification(

    sellerId,

    {

      title:
        "Drop-off window missed",

      message:
        `You did not drop off your item(s) for order ${orderId} at Biashnet within the 36-hour window. The buyer is now being asked to accept the order without your item(s) or cancel it — your payout for this order may be refunded to the buyer.`,

      type:
        "DROPOFF_NON_COMPLIANT",

      orderId,

    }

  );

}


/*
=========================================================
BUYER PARTIAL-FULFILLMENT CHOICE
=========================================================
*/

async function notifyBuyerPartialFulfillmentChoice({

  buyerId,

  orderId,

  availableSellerCount,

  totalSellerCount,

}) {

  return createNotification(

    buyerId,

    {

      title:
        "Action needed on your order",

      message:
        availableSellerCount > 0
          ? `${availableSellerCount} of ${totalSellerCount} sellers on order ${orderId} did not drop off their item(s) in time. Choose whether to receive the available items or cancel the order for a full refund.`
          : `None of the sellers on order ${orderId} dropped off their item(s) in time. Please cancel the order for a full refund.`,

      type:
        "PARTIAL_FULFILLMENT_CHOICE",

      orderId,

    }

  );

}


/*
=========================================================
MARK AS READ
=========================================================
*/

async function markNotificationRead(
  notificationId,
  userId
) {

  if (
    !notificationId ||
    !userId
  ) {

    throw new Error(
      "Notification ID and user ID are required."
    );

  }


  const ref =
    db
      .collection(
        COLLECTIONS.NOTIFICATIONS
      )
      .doc(notificationId);


  const snap =
    await ref.get();


  if (!snap.exists) {

    throw new Error(
      "Notification not found."
    );

  }


  const notification =
    snap.data();


  /*
  -------------------------------------------------------
  SECURITY
  -------------------------------------------------------
  */

  if (
    notification.userId !==
    userId
  ) {

    throw new Error(
      "You cannot modify this notification."
    );

  }


  await ref.update({

    read:
      true,

    readAt:
      FieldValue.serverTimestamp(),

  });


  return {

    success: true,

  };

}


/*
=========================================================
GET USER NOTIFICATIONS
=========================================================
*/

async function getUserNotifications(
  userId,
  limit = 50
) {

  if (!userId) {

    throw new Error(
      "User ID is required."
    );

  }


  /*
  =======================================================
  NO COMPOSITE INDEX

  where("userId") + orderBy("createdAt") is a composite
  index Firestore will refuse the query without, and this
  one had never been exercised over HTTP, so the failure
  would only have surfaced the moment the notifications
  screen went live. Sort in JS instead — the same approach
  getUserWithdrawals already documents.

  The limit is applied after sorting, so it is genuinely
  the newest N rather than an arbitrary N.
  =======================================================
  */

  const snapshot =
    await db
      .collection(
        COLLECTIONS.NOTIFICATIONS
      )
      .where(
        "userId",
        "==",
        userId
      )
      .get();


  const notifications =
    snapshot.docs.map(
      doc => ({

        id:
          doc.id,

        ...doc.data(),

      })
    );


  const time =
    (value) =>
      value?.toMillis
        ? value.toMillis()
        : new Date(
            value || 0
          ).getTime();


  notifications.sort(
    (a, b) =>
      time(b.createdAt) -
      time(a.createdAt)
  );


  const max =
    Number(limit) > 0
      ? Number(limit)
      : 50;


  return notifications.slice(
    0,
    max
  );

}


/*
=========================================================
MARK EVERY NOTIFICATION READ
=========================================================

One tap to clear the badge. Batched, because a user who
has never opened the screen can have a lot of them.
=========================================================
*/

async function markAllNotificationsRead(
  userId
) {

  if (!userId) {

    throw new Error(
      "User ID is required."
    );

  }


  const snapshot =
    await db
      .collection(
        COLLECTIONS.NOTIFICATIONS
      )
      .where(
        "userId",
        "==",
        userId
      )
      .where(
        "read",
        "==",
        false
      )
      .get();


  if (snapshot.empty) {

    return {
      success: true,
      updated: 0,
    };

  }


  /*
  Firestore caps a batch at 500 writes.
  */

  const docs =
    snapshot.docs;

  let updated = 0;


  for (
    let start = 0;
    start < docs.length;
    start += 500
  ) {

    const batch =
      db.batch();

    docs
      .slice(start, start + 500)
      .forEach(
        (doc) => {

          batch.update(
            doc.ref,
            {

              read: true,

              readAt:
                FieldValue.serverTimestamp(),

            }
          );

          updated += 1;

        }
      );

    await batch.commit();

  }


  return {
    success: true,
    updated,
  };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

  createNotification,

  notifyBuyerPaymentSuccess,

  notifySellerNewOrder,

  notifyBuyerOrderCompleted,

  notifySellerOrderCompleted,

  notifySellerNonCompliant,

  notifyBuyerPartialFulfillmentChoice,

  markNotificationRead,

  markAllNotificationsRead,

  getUserNotifications,

};