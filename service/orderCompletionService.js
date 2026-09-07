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
  PAYMENT_STATUS,
  SELLER_PAYMENT_STATUS,
  PAYOUT_STATUS,
} = require("../config/paymentConstants");

const {
  generateCompletionCode,
} = require("../utils/codeGenerator");

const {
  settleMarketplaceOrder,
} = require("./settlementService");


/*
=========================================================
BIASHNET ORDER COMPLETION SERVICE
=========================================================

BUSINESS FLOW

M-PESA SUCCESSFUL
        ↓
ORDER = PAID
        ↓
SELLER FUNDS = HELD
        ↓
BUYER GETS COMPLETION CODE
        ↓
SELLER DELIVERS PRODUCT
        ↓
SELLER ENTERS BUYER CODE
        ↓
BACKEND VERIFIES CODE
        ↓
ORDER = COMPLETED
        ↓
SETTLEMENT SERVICE
        ↓
SELLER FUNDS RELEASED
        ↓
SELLER AVAILABLE WALLET BALANCE
        ↓
SELLER CAN REQUEST WITHDRAWAL


SECURITY

- Buyer receives the plain code.
- Firestore stores a hash + encrypted copy.
- Seller never receives the code automatically.
- Code belongs to the order.
- Code can only be used once.
- Wrong attempts are tracked.
- Seller must belong to order.sellerBreakdown.
- Settlement only happens after successful code verification.
=========================================================
*/


/*
=========================================================
CONFIGURATION
=========================================================
*/

const CODE_LENGTH = 6;

const MAX_VERIFICATION_ATTEMPTS = 5;


/*
=========================================================
ENCRYPTION KEY
=========================================================

.env

ORDER_CODE_ENCRYPTION_KEY=
64_HEX_CHARACTERS

Generate:

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

IMPORTANT:

Do NOT change the key after codes have already been
generated unless you also migrate/re-encrypt existing
codes.
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
    Buffer.from(
      key,
      "hex"
    );

  if (
    buffer.length !== 32
  ) {

    throw new Error(
      "ORDER_CODE_ENCRYPTION_KEY must be exactly 32 bytes / 64 hex characters."
    );

  }

  return buffer;

}


/*
=========================================================
GENERATE RANDOM 6-DIGIT CODE
=========================================================
*/

function generatePlainCode() {

  const min =
    10 ** (
      CODE_LENGTH - 1
    );

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
NORMALIZE CODE
=========================================================
*/

function normalizeCode(
  code
) {

  return String(
    code || ""
  )
    .trim()
    .toUpperCase();

}


/*
=========================================================
VALIDATE CODE
=========================================================
*/

function validateCodeFormat(
  code
) {

  const normalized =
    normalizeCode(
      code
    );

  if (!normalized) {

    throw new Error(
      "Completion code is required."
    );

  }

  if (
    normalized.length !==
    CODE_LENGTH
  ) {

    throw new Error(
      "Invalid completion code."
    );

  }

  /*
   * Current BIASHNET codes are numeric.
   */

  if (
    !/^\d{6}$/.test(
      normalized
    )
  ) {

    throw new Error(
      "Completion code must contain 6 digits."
    );

  }

  return normalized;

}


/*
=========================================================
HASH CODE
=========================================================
*/

function hashCode(
  code
) {

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      String(code)
    )
    .digest(
      "hex"
    );

}


/*
=========================================================
ENCRYPT CODE
=========================================================
*/

function encryptCode(
  code
) {

  const key =
    getEncryptionKey();

  const iv =
    crypto.randomBytes(
      12
    );

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

function decryptCode(
  encryptedCode
) {

  const key =
    getEncryptionKey();

  const parts =
    String(
      encryptedCode
    ).split(":");

  if (
    parts.length !== 3
  ) {

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

      decipher.update(
        encrypted
      ),

      decipher.final(),

    ]);

  return decrypted.toString(
    "utf8"
  );

}


/*
=========================================================
CONSTANT-TIME HASH COMPARISON
=========================================================
*/

function hashesMatch(
  submittedHash,
  storedHash
) {

  if (
    !submittedHash ||
    !storedHash
  ) {

    return false;

  }

  const submitted =
    Buffer.from(
      String(
        submittedHash
      ),
      "hex"
    );

  const stored =
    Buffer.from(
      String(
        storedHash
      ),
      "hex"
    );

  if (
    submitted.length !==
    stored.length
  ) {

    return false;

  }

  return crypto.timingSafeEqual(
    submitted,
    stored
  );

}


/*
=========================================================
GET ORDER
=========================================================
*/

async function getOrder(
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
      .doc(
        orderId
      );

  const snapshot =
    await orderRef.get();

  if (
    !snapshot.exists
  ) {

    throw new Error(
      "Marketplace order not found."
    );

  }

  return {

    ref:
      orderRef,

    data:
      snapshot.data(),

  };

}


/*
=========================================================
GENERATE ORDER COMPLETION CODE
=========================================================

Called after successful M-PESA payment.

The buyer can later retrieve the code.

Firestore stores:

orderCompletionCodeHash
orderCompletionCodeEncrypted
orderCompletionCodeStatus
orderCompletionCodeCreatedAt
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

  const {
    ref: orderRef,
    data: order,
  } =
    await getOrder(
      orderId
    );


  /*
  =======================================================
  DUPLICATE PROTECTION
  =======================================================
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

      created:
        false,

      alreadyExists:
        true,

      orderId,

      code,

    };

  }


  /*
  =======================================================
  PAYMENT MUST BE COMPLETE
  =======================================================
  */

  if (
    order.paymentStatus !==
    PAYMENT_STATUS.COMPLETED
  ) {

    throw new Error(
      "Completion code can only be generated after successful payment."
    );

  }


  /*
  =======================================================
  SELLER FUNDS MUST BE HELD
  =======================================================
  */

  if (
    order.fundsHeld !== true
  ) {

    throw new Error(
      "Seller funds must be held before generating a completion code."
    );

  }


  /*
  =======================================================
  GENERATE CODE
  =======================================================
  */

  const code =
    generatePlainCode();

  const normalizedCode =
    normalizeCode(
      code
    );

  const codeHash =
    hashCode(
      normalizedCode
    );

  const encryptedCode =
    encryptCode(
      normalizedCode
    );


  /*
  =======================================================
  SAVE CODE
  =======================================================
  */

  await orderRef.update({

    orderCompletionCodeHash:
      codeHash,

    orderCompletionCodeEncrypted:
      encryptedCode,

    orderCompletionCodeStatus:
      "ACTIVE",

    orderCompletionCodeUsed:
      false,

    orderCompletionCodeAttempts:
      0,

    orderCompletionCodeCreatedAt:
      FieldValue.serverTimestamp(),

    settlementStatus:
      "NOT_STARTED",

    updatedAt:
      FieldValue.serverTimestamp(),

  });


  console.log(
    "✅ BIASHNET completion code generated:",
    orderId
  );


  /*
  =======================================================
  RETURN PLAIN CODE
  =======================================================

  IMPORTANT

  The plain code is returned to the buyer only.

  Never save the plain code directly in Firestore.
  =======================================================
  */

  return {

    created:
      true,

    alreadyExists:
      false,

    orderId,

    code:
      normalizedCode,

    message:
      "Completion code generated. Keep it safe and provide it to the seller only after successful delivery.",

  };

}


/*
=========================================================
GET BUYER COMPLETION CODE
=========================================================

Only the buyer can retrieve the code.
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

  const {
    data: order,
  } =
    await getOrder(
      orderId
    );


  /*
  =======================================================
  BUYER OWNERSHIP
  =======================================================
  */

  if (
    order.buyerId !==
    buyerId
  ) {

    throw new Error(
      "You are not authorized to view this completion code."
    );

  }


  /*
  =======================================================
  MUST BE ACTIVE
  =======================================================
  */

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

SELLER SUBMITS:

orderId
sellerId
code

PROCESS:

1. Find order
2. Verify seller belongs to order
3. Verify payment completed
4. Verify funds held
5. Verify code active
6. Check attempts
7. Hash submitted code
8. Compare hashes
9. Mark code used
10. Mark order completed
11. Call settlementService
12. Record settlement result

=========================================================
*/

async function verifyCompletionCode({

  orderId,

  code,

  sellerId,

}) {

  console.log(
    "=========================================="
  );

  console.log(
    "🔐 BIASHNET VERIFY COMPLETION CODE"
  );

  console.log(
    "Order:",
    orderId
  );

  console.log(
    "Seller:",
    sellerId
  );

  console.log(
    "=========================================="
  );


  /*
  =======================================================
  VALIDATION
  =======================================================
  */

  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }

  if (!sellerId) {

    throw new Error(
      "Seller ID is required."
    );

  }

  const normalizedCode =
    validateCodeFormat(
      code
    );


  /*
  =======================================================
  LOAD ORDER
  =======================================================
  */

  const {
    ref: orderRef,
    data: order,
  } =
    await getOrder(
      orderId
    );


  /*
  =======================================================
  VERIFY SELLER
  =======================================================
  */

  const sellerInOrder =
    Array.isArray(
      order.sellerBreakdown
    ) &&
    order.sellerBreakdown.some(
      seller =>
        seller &&
        seller.sellerId ===
        sellerId
    );


  if (!sellerInOrder) {

    throw new Error(
      "Seller is not part of this order."
    );

  }


  /*
  =======================================================
  ALREADY COMPLETED
  =======================================================
  */

  if (
    order.status ===
    ORDER_STATUS.COMPLETED
  ) {

    return {

      success:
        true,

      alreadyCompleted:
        true,

      orderId,

      settlementStatus:
        order.settlementStatus ||
        "UNKNOWN",

      message:
        "This order has already been completed.",

    };

  }


  /*
  =======================================================
  PAYMENT MUST BE COMPLETE
  =======================================================
  */

  if (
    order.paymentStatus !==
    PAYMENT_STATUS.COMPLETED
  ) {

    throw new Error(
      "This order has not been successfully paid."
    );

  }


  /*
  =======================================================
  FUNDS MUST BE HELD
  =======================================================
  */

  if (
    order.fundsHeld !== true
  ) {

    throw new Error(
      "Seller funds are not currently held for this order."
    );

  }


  /*
  =======================================================
  SELLER PAYMENT STATUS
  =======================================================
  */

  if (
    order.sellerPaymentStatus &&
    order.sellerPaymentStatus !==
      SELLER_PAYMENT_STATUS.HELD
  ) {

    throw new Error(
      "Seller funds are not in the expected held state."
    );

  }


  /*
  =======================================================
  CODE MUST EXIST
  =======================================================
  */

  if (
    !order.orderCompletionCodeHash
  ) {

    throw new Error(
      "This order does not have a completion code."
    );

  }


  /*
  =======================================================
  CODE STATUS
  =======================================================
  */

  if (
    order.orderCompletionCodeStatus !==
    "ACTIVE"
  ) {

    throw new Error(
      "This completion code is not active."
    );

  }


  /*
  =======================================================
  CODE ALREADY USED
  =======================================================
  */

  if (
    order.orderCompletionCodeUsed ===
    true
  ) {

    throw new Error(
      "This completion code has already been used."
    );

  }


  /*
  =======================================================
  ATTEMPTS
  =======================================================
  */

  const attempts =
    Number(
      order.orderCompletionCodeAttempts ||
      0
    );


  if (
    attempts >=
    MAX_VERIFICATION_ATTEMPTS
  ) {

    await orderRef.update({

      orderCompletionCodeStatus:
        "LOCKED",

      updatedAt:
        FieldValue.serverTimestamp(),

    });

    throw new Error(
      "Too many incorrect completion code attempts. Verification has been locked."
    );

  }


  /*
  =======================================================
  HASH SUBMITTED CODE
  =======================================================
  */

  const submittedHash =
    hashCode(
      normalizedCode
    );


  /*
  =======================================================
  CONSTANT-TIME COMPARISON
  =======================================================
  */

  const valid =
    hashesMatch(
      submittedHash,
      order.orderCompletionCodeHash
    );


  /*
  =======================================================
  INVALID CODE
  =======================================================
  */

  if (!valid) {

    const newAttempts =
      attempts + 1;

    const updateData = {

      orderCompletionCodeAttempts:
        newAttempts,

      updatedAt:
        FieldValue.serverTimestamp(),

    };


    if (
      newAttempts >=
      MAX_VERIFICATION_ATTEMPTS
    ) {

      updateData.orderCompletionCodeStatus =
        "LOCKED";

    }


    await orderRef.update(
      updateData
    );


    throw new Error(
      newAttempts >=
      MAX_VERIFICATION_ATTEMPTS
        ? "Too many incorrect attempts. Completion code verification has been locked."
        : "Incorrect completion code."
    );

  }


  /*
  =======================================================
  CODE IS CORRECT
  =======================================================
  */

  const now =
    FieldValue.serverTimestamp();


  /*
  =======================================================
  MARK COMPLETION
  =======================================================

  We record completion before settlement.

  settlementService is then responsible for releasing
  the held seller funds.

  If settlement fails, we DO NOT pretend the money
  was released. settlementStatus becomes PENDING.
  =======================================================
  */

  await orderRef.update({

    orderCompletionCodeUsed:
      true,

    orderCompletionCodeUsedAt:
      now,

    orderCompletionCodeUsedBy:
      sellerId,

    orderCompletionCodeStatus:
      "USED",

    orderCompletionCodeAttempts:
      attempts + 1,

    status:
      ORDER_STATUS.COMPLETED,

    settlementStatus:
      "PROCESSING",

    updatedAt:
      now,

  });


  console.log(
    "✅ Completion code verified:",
    orderId
  );


  /*
  =======================================================
  SETTLE MARKETPLACE ORDER
  =======================================================

  IMPORTANT

  This calls your existing settlement service.

  Expected contract:

  settleMarketplaceOrder({
      orderId,
      sellerId,
      completionCodeVerified: true
  })

  The settlement service must:

  - verify the order
  - verify the seller
  - verify held funds
  - release seller funds
  - update seller wallet
  - update seller payout status
  - record the settlement transaction
  - be idempotent
  =======================================================
  */

  let settlement;

  try {

    settlement =
      await settleMarketplaceOrder({

        orderId,

        sellerId,

        completionCodeVerified:
          true,

      });


    /*
    =====================================================
    SETTLEMENT SUCCESS
    =====================================================
    */

    await orderRef.update({

      settlementStatus:
        "COMPLETED",

      settlementCompletedAt:
        FieldValue.serverTimestamp(),

      settlementError:
        null,

      updatedAt:
        FieldValue.serverTimestamp(),

    });


    console.log(
      "✅ Seller settlement completed:",
      orderId,
      sellerId
    );


  } catch (settlementError) {

    console.error(
      "❌ Seller settlement failed:",
      settlementError
    );


    /*
    =====================================================
    IMPORTANT

    ORDER IS COMPLETED.

    PAYMENT REMAINS SAFE.

    MONEY MUST REMAIN HELD UNTIL SETTLEMENT
    IS SUCCESSFULLY RETRIED.
    =====================================================
    */

    await orderRef.update({

      settlementStatus:
        "PENDING",

      settlementError:
        settlementError.message,

      updatedAt:
        FieldValue.serverTimestamp(),

    });


    return {

      success:
        true,

      alreadyCompleted:
        false,

      orderId,

      sellerId,

      status:
        ORDER_STATUS.COMPLETED,

      completionCodeVerified:
        true,

      settlementStatus:
        "PENDING",

      settlement: null,

      message:
        "Completion code verified. Seller settlement is pending processing.",

    };

  }


  /*
  =======================================================
  SUCCESS
  =======================================================
  */

  return {

    success:
      true,

    alreadyCompleted:
      false,

    orderId,

    sellerId,

    status:
      ORDER_STATUS.COMPLETED,

    completionCodeVerified:
      true,

    settlementStatus:
      "COMPLETED",

    settlement,

    message:
      "Order completed successfully and seller settlement processed.",

  };

}


/*
=========================================================
GET COMPLETION STATUS
=========================================================
*/

async function getCompletionStatus(
  orderId
) {

  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }

  const {
    data: order,
  } =
    await getOrder(
      orderId
    );


  return {

    orderId,

    orderStatus:
      order.status,

    paymentStatus:
      order.paymentStatus,

    completionCodeCreated:
      Boolean(
        order.orderCompletionCodeHash
      ),

    completionCodeStatus:
      order.orderCompletionCodeStatus ||
      "NOT_CREATED",

    completionCodeUsed:
      order.orderCompletionCodeUsed ===
      true,

    attempts:
      Number(
        order.orderCompletionCodeAttempts ||
        0
      ),

    completionCodeCreatedAt:
      order.orderCompletionCodeCreatedAt ||
      null,

    completionCodeUsedAt:
      order.orderCompletionCodeUsedAt ||
      null,

    settlementStatus:
      order.settlementStatus ||
      "NOT_STARTED",

    settlementCompletedAt:
      order.settlementCompletedAt ||
      null,

  };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

  generateOrderCompletionCode,

  getBuyerCompletionCode,

  verifyCompletionCode,

  getCompletionStatus,

};