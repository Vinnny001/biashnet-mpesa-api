const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");


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
        `Your order ${orderId} has been completed successfully.`,

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

}) {

  return createNotification(

    sellerId,

    {

      title:
        "Funds Released",

      message:
        `Order ${orderId} has been completed and your seller funds of KES ${Number(amount).toLocaleString()} have been released.`,

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
      .orderBy(
        "createdAt",
        "desc"
      )
      .limit(
        Number(limit)
      )
      .get();


  return snapshot.docs.map(
    doc => ({

      id:
        doc.id,

      ...doc.data(),

    })
  );

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

  getUserNotifications,

};