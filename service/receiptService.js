const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");


/*
=========================================================
MARKETPLACE RECEIPT SERVICE
=========================================================

Responsible for:

- Create payment receipt
- Retrieve receipt
- Prevent duplicate receipts
- Build buyer-facing receipt data

Does NOT:

- Process M-PESA
- Generate completion codes
- Release seller funds
- Handle HTTP

=========================================================
*/


/*
=========================================================
RECEIPT COLLECTION
=========================================================
*/

const RECEIPTS_COLLECTION =
  COLLECTIONS.MARKETPLACE_RECEIPTS ||
  "marketplaceReceipts";


/*
=========================================================
CREATE RECEIPT
=========================================================
*/

async function createMarketplaceReceipt(
  orderId
) {

  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }


  /*
  -------------------------------------------------------
  GET ORDER
  -------------------------------------------------------
  */

  const orderRef =
    db
      .collection(
        COLLECTIONS.ORDERS
      )
      .doc(orderId);


  const orderSnap =
    await orderRef.get();


  if (!orderSnap.exists) {

    throw new Error(
      "Marketplace order not found."
    );

  }


  const order =
    orderSnap.data();


  /*
  -------------------------------------------------------
  ONLY PAID ORDERS
  -------------------------------------------------------
  */

  if (
    order.paymentStatus !==
    "COMPLETED"
  ) {

    throw new Error(
      "Receipt can only be generated for a completed payment."
    );

  }


  /*
  -------------------------------------------------------
  RECEIPT ID
  -------------------------------------------------------
  */

  const receiptId =
    `RCT-${orderId}`;


  const receiptRef =
    db
      .collection(
        RECEIPTS_COLLECTION
      )
      .doc(receiptId);


  /*
  -------------------------------------------------------
  DUPLICATE PROTECTION
  -------------------------------------------------------
  */

  const existing =
    await receiptRef.get();


  if (existing.exists) {

    return {

      created: false,

      receiptId,

      ...existing.data(),

    };

  }


  /*
  -------------------------------------------------------
  BUILD ITEMS
  -------------------------------------------------------
  */

  const items =
    (order.items || [])
      .map(item => ({

        listingId:
          item.listingId || null,

        title:
          item.title || "Marketplace Product",

        image:
          item.image || null,

        category:
          item.category || null,

        quantity:
          Number(
            item.quantity || 1
          ),

        unitPrice:
          Number(
            item.unitPrice || 0
          ),

        itemTotal:
          Number(
            item.itemTotal || 0
          ),

      }));


  /*
  -------------------------------------------------------
  BUILD SELLER INFORMATION
  -------------------------------------------------------
  */

  const sellers =
    (order.sellerBreakdown || [])
      .map(seller => ({

        sellerId:
          seller.sellerId || null,

        sellerName:
          seller.sellerName || "Seller",

        grossAmount:
          Number(
            seller.grossAmount ||
            seller.sellerGross ||
            0
          ),

      }));


  /*
  -------------------------------------------------------
  RECEIPT DATA
  -------------------------------------------------------
  */

  const receipt = {

    receiptId,

    receiptNumber:
      order.providerTransactionId ||
      order.paymentId ||
      receiptId,

    orderId,

    paymentId:
      order.paymentId || null,

    buyerId:
      order.buyerId,

    buyerPhone:
      order.buyerPhone ||
      order.phone ||
      null,

    currency:
      order.currency ||
      "KES",

    paymentMethod:
      order.paymentMethod ||
      "MPESA",

    provider:
      "MPESA",

    providerTransactionId:
      order.providerTransactionId ||
      null,

    checkoutRequestID:
      order.checkoutRequestID ||
      null,

    merchantRequestID:
      order.merchantRequestID ||
      null,

    items,

    sellers,

    subtotal:
      Number(
        order.subtotal || 0
      ),

    deliveryFee:
      Number(
        order.deliveryFee || 0
      ),

    totalPaid:
      Number(
        order.buyerTotal || 0
      ),

    commissionAmount:
      Number(
        order.commissionAmount || 0
      ),

    deliveryAddress:
      order.deliveryAddress || null,

    paymentStatus:
      order.paymentStatus,

    orderStatus:
      order.status,

    paidAt:
      order.paymentCompletedAt ||
      FieldValue.serverTimestamp(),

    createdAt:
      FieldValue.serverTimestamp(),

    updatedAt:
      FieldValue.serverTimestamp(),

  };


  /*
  -------------------------------------------------------
  SAVE RECEIPT
  -------------------------------------------------------
  */

  await receiptRef.set(
    receipt
  );


  return {

    created: true,

    receiptId,

    ...receipt,

  };

}


/*
=========================================================
GET RECEIPT
=========================================================
*/

async function getMarketplaceReceipt(
  orderId,
  buyerId
) {

  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }


  if (!buyerId) {

    throw new Error(
      "Buyer ID is required."
    );

  }


  const receiptId =
    `RCT-${orderId}`;


  const receiptRef =
    db
      .collection(
        RECEIPTS_COLLECTION
      )
      .doc(receiptId);


  const snap =
    await receiptRef.get();


  if (!snap.exists) {

    return null;

  }


  const receipt =
    snap.data();


  /*
  -------------------------------------------------------
  BUYER OWNERSHIP
  -------------------------------------------------------
  */

  if (
    receipt.buyerId !==
    buyerId
  ) {

    throw new Error(
      "You are not authorized to view this receipt."
    );

  }


  return {

    receiptId:
      snap.id,

    ...receipt,

  };

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  createMarketplaceReceipt,

  getMarketplaceReceipt,

};