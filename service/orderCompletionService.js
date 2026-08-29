const crypto = require("crypto");

const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");

const {
  ORDER_STATUS,
} = require("../config/paymentConstants");


/*
=========================================================
ORDER COMPLETION SERVICE
=========================================================

Responsible for:

- Generate buyer completion code
- Store secure hash
- Store buyer-readable encrypted code
- Verify completion code
- Mark order completed

Does NOT:

- Process M-PESA
- Release seller funds
- Send notifications
- Handle HTTP requests

Those belong to:

paymentCallbackService
notificationService
orderController
payout/wallet services

=========================================================
*/


/*
=========================================================
CODE CONFIGURATION
=========================================================
*/

const CODE_LENGTH = 6;


/*
=========================================================
GET ENCRYPTION KEY
=========================================================

Add to .env:

ORDER_CODE_ENCRYPTION_KEY=64_HEX_CHARACTERS

Generate with:

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

=========================================================
*/

function getEncryptionKey() {

  const key =
    process.env.ORDER_CODE_ENCRYPTION_KEY;

  if (!key) {

    throw new Error(
      "ORDER_CODE_ENCRYPTION_KEY is not configured."
    );

  }

  const buffer =
    Buffer.from(key, "hex");

  if (buffer.length !== 32) {

    throw new Error(
      "ORDER_CODE_ENCRYPTION_KEY must be exactly 32 bytes / 64 hex characters."
    );

  }

  return buffer;

}


/*
=========================================================
GENERATE RANDOM CODE
=========================================================
*/

function generatePlainCode() {

  const min =
    10 ** (CODE_LENGTH - 1);

  const max =
    10 ** CODE_LENGTH - 1;

  return String(
    crypto.randomInt(
      min,
      max + 1
    )
  );

}


/*
=========================================================
HASH CODE
=========================================================
*/

function hashCode(code) {

  return crypto
    .createHash("sha256")
    .update(String(code))
    .digest("hex");

}


/*
=========================================================
ENCRYPT CODE
=========================================================

The hash is used for verification.

The encrypted value is used when
the authenticated buyer needs to
see the code.

=========================================================
*/

function encryptCode(code) {

  const key =
    getEncryptionKey();

  const iv =
    crypto.randomBytes(12);

  const cipher =
    crypto.createCipheriv(
      "aes-256-gcm",
      key,
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        String(code),
        "utf8"
      ),
      cipher.final(),
    ]);

  const authTag =
    cipher.getAuthTag();

  return [

    iv.toString("hex"),

    authTag.toString("hex"),

    encrypted.toString("hex"),

  ].join(":");

}


/*
=========================================================
DECRYPT CODE
=========================================================
*/

function decryptCode(encryptedCode) {

  const key =
    getEncryptionKey();

  const parts =
    String(encryptedCode)
      .split(":");

  if (parts.length !== 3) {

    throw new Error(
      "Invalid encrypted completion code."
    );

  }

  const iv =
    Buffer.from(
      parts[0],
      "hex"
    );

  const authTag =
    Buffer.from(
      parts[1],
      "hex"
    );

  const encrypted =
    Buffer.from(
      parts[2],
      "hex"
    );

  const decipher =
    crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      iv
    );

  decipher.setAuthTag(
    authTag
  );

  const decrypted =
    Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

  return decrypted.toString("utf8");

}


/*
=========================================================
GENERATE ORDER COMPLETION CODE
=========================================================

Called after successful payment.

=========================================================
*/

async function generateOrderCompletionCode(
  orderId
) {

  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }


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
  DUPLICATE PROTECTION
  -------------------------------------------------------
  */

  if (
    order.orderCompletionCodeStatus ===
    "ACTIVE"
  ) {

    let code = null;

    if (
      order.orderCompletionCodeEncrypted
    ) {

      code =
        decryptCode(
          order.orderCompletionCodeEncrypted
        );

    }

    return {

      created: false,

      alreadyExists: true,

      orderId,

      code,

    };

  }


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
      "Completion code can only be generated for a completed payment."
    );

  }


  /*
  -------------------------------------------------------
  GENERATE CODE
  -------------------------------------------------------
  */

  const code =
    generatePlainCode();

  const hash =
    hashCode(code);

  const encrypted =
    encryptCode(code);


  /*
  -------------------------------------------------------
  SAVE
  -------------------------------------------------------
  */

  await orderRef.update({

    orderCompletionCodeHash:
      hash,

    orderCompletionCodeEncrypted:
      encrypted,

    orderCompletionCodeStatus:
      "ACTIVE",

    orderCompletionCodeCreatedAt:
      FieldValue.serverTimestamp(),

    updatedAt:
      FieldValue.serverTimestamp(),

  });


  return {

    created: true,

    alreadyExists: false,

    orderId,

    code,

  };

}


/*
=========================================================
GET BUYER COMPLETION CODE
=========================================================

Only call this after authentication and
buyer ownership has been verified by the
controller.

=========================================================
*/

async function getBuyerCompletionCode(
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


  const orderRef =
    db
      .collection(
        COLLECTIONS.ORDERS
      )
      .doc(orderId);


  const snap =
    await orderRef.get();


  if (!snap.exists) {

    throw new Error(
      "Order not found."
    );

  }


  const order =
    snap.data();


  if (
    order.buyerId !==
    buyerId
  ) {

    throw new Error(
      "You are not authorized to view this order."
    );

  }


  if (
    order.orderCompletionCodeStatus !==
    "ACTIVE"
  ) {

    return null;

  }


  if (
    !order.orderCompletionCodeEncrypted
  ) {

    throw new Error(
      "Completion code is unavailable."
    );

  }


  return decryptCode(
    order.orderCompletionCodeEncrypted
  );

}


/*
=========================================================
VERIFY COMPLETION CODE
=========================================================

Seller submits the code.

=========================================================
*/

async function verifyCompletionCode({
  orderId,
  code,
  sellerId,
}) {

  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }

  if (!code) {

    throw new Error(
      "Completion code is required."
    );

  }

  if (!sellerId) {

    throw new Error(
      "Seller ID is required."
    );

  }


  const orderRef =
    db
      .collection(
        COLLECTIONS.ORDERS
      )
      .doc(orderId);


  const snap =
    await orderRef.get();


  if (!snap.exists) {

    throw new Error(
      "Marketplace order not found."
    );

  }


  const order =
    snap.data();


  /*
  -------------------------------------------------------
  VERIFY SELLER
  -------------------------------------------------------
  */

  const sellerExists =
    (order.sellerBreakdown || [])
      .some(
        seller =>
          seller.sellerId ===
          sellerId
      );


  if (!sellerExists) {

    throw new Error(
      "Seller is not part of this order."
    );

  }


  /*
  -------------------------------------------------------
  ALREADY COMPLETED
  -------------------------------------------------------
  */

  if (
    order.status ===
    ORDER_STATUS.COMPLETED
  ) {

    return {

      success: true,

      alreadyCompleted: true,

      orderId,

    };

  }


  /*
  -------------------------------------------------------
  CODE MUST BE ACTIVE
  -------------------------------------------------------
  */

  if (
    order.orderCompletionCodeStatus !==
    "ACTIVE"
  ) {

    throw new Error(
      "Order completion code is not active."
    );

  }


  /*
  -------------------------------------------------------
  HASH PROVIDED CODE
  -------------------------------------------------------
  */

  const suppliedHash =
    hashCode(
      String(code).trim()
    );


  /*
  -------------------------------------------------------
  VERIFY HASH
  -------------------------------------------------------
  */

  if (
    suppliedHash !==
    order.orderCompletionCodeHash
  ) {

    throw new Error(
      "Invalid order completion code."
    );

  }


  /*
  -------------------------------------------------------
  COMPLETE ORDER
  -------------------------------------------------------
  */

  await orderRef.update({

    status:
      ORDER_STATUS.COMPLETED,

    orderCompletionCodeStatus:
      "USED",

    completedBy:
      sellerId,

    orderCompletedAt:
      FieldValue.serverTimestamp(),

    updatedAt:
      FieldValue.serverTimestamp(),

  });


  return {

    success: true,

    alreadyCompleted: false,

    orderId,

    completedBy:
      sellerId,

  };

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  generateOrderCompletionCode,

  getBuyerCompletionCode,

  verifyCompletionCode,

};