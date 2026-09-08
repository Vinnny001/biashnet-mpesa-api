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
  SUB_ORDER_STATUS,
} = require("../config/paymentConstants");

const {
  generateCompletionCode,
} = require("../utils/codeGenerator");

const {
  getSubOrdersForOrder,
} = require("./logisticsService");

const {
  releaseSubOrder,
} = require("./subOrderSettlementService");


/*
=========================================================
BIASHNET ORDER COMPLETION SERVICE
=========================================================

BUSINESS FLOW (updated — logistics-managed fulfillment)

Sellers no longer hand items to buyers directly. Each
seller drops their item(s) at Biashnet and the logistics/
supply-chain manager confirms receipt per sub-order (see
service/logisticsService.js) — no code involved for that
leg, just an order/sub-order ID lookup.

The buyer's completion code now confirms the FINAL
Biashnet → buyer handoff, once every sub-order for the
order is ready:

M-PESA SUCCESSFUL
        ↓
ORDER = PAID, sub-orders created (PENDING_DROPOFF, 36h each)
        ↓
BUYER GETS COMPLETION CODE
        ↓
sellers drop off at Biashnet; logistics confirms each
sub-order (AT_BIASHNET) — see logisticsService.confirmDropoff
        ↓
[if a sub-order misses its 36h window: complianceSweepService
marks it NON_COMPLIANT and the buyer is asked to accept the
available items or cancel — see orderService.resolvePartial]
        ↓
once every sub-order is AT_BIASHNET (or already resolved),
Biashnet delivers the consolidated order to the buyer
        ↓
BUYER GIVES THE CODE TO BIASHNET'S DELIVERY/LOGISTICS AGENT
        ↓
BACKEND VERIFIES CODE (this function)
        ↓
ORDER = COMPLETED
        ↓
every AT_BIASHNET sub-order is released via
subOrderSettlementService.releaseSubOrder
        ↓
SELLER AVAILABLE WALLET BALANCE
        ↓
SELLER CAN REQUEST WITHDRAWAL


SECURITY

- Buyer receives the plain code.
- Firestore stores a hash + encrypted copy.
- Code belongs to the order.
- Code can only be used once.
- Wrong attempts are tracked.
- Verification is performed by Biashnet logistics staff
  (requireEmployeeRole("logistics","admin") on the route),
  not by any particular seller.
- Settlement only happens after successful code verification
  (or, for non-compliant sellers, via the separate
  accept-partial/cancel resolution path).
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

BIASHNET LOGISTICS STAFF SUBMITS (on final delivery to
the buyer — not a seller anymore):

orderId
code
confirmedBy   // logistics manager's uid

PROCESS:

1. Find order
2. Verify payment completed
3. Verify funds held
4. Verify every sub-order is ready (none PENDING_DROPOFF)
5. Verify code active
6. Check attempts
7. Hash submitted code
8. Compare hashes
9. Mark code used
10. Mark order completed
11. Release every AT_BIASHNET sub-order via subOrderSettlementService
12. Record settlement result

=========================================================
*/

async function verifyCompletionCode({

  orderId,

  code,

  confirmedBy,

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
    "Confirmed by (logistics):",
    confirmedBy
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

  if (!confirmedBy) {

    throw new Error(
      "Confirming logistics manager ID is required."
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
  ALL SUB-ORDERS MUST BE READY
  =======================================================

  Biashnet cannot deliver a consolidated order to the
  buyer while a seller still hasn't dropped off their
  item(s). If any sub-order is still PENDING_DROPOFF, the
  order isn't ready yet — the buyer should not be asked
  for their code until either every seller has complied,
  or non-compliant sub-orders have already been resolved
  via the accept-partial/cancel decision
  (orderService.resolvePartial).
  =======================================================
  */

  const subOrders =
    await getSubOrdersForOrder(
      orderId
    );

  const stillWaitingOnSeller =
    subOrders.some(
      (subOrder) =>
        subOrder.status ===
        SUB_ORDER_STATUS.PENDING_DROPOFF
    );

  if (
    stillWaitingOnSeller
  ) {

    throw new Error(
      "This order is not ready for delivery yet — still waiting on a seller drop-off."
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
      confirmedBy,

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
  RELEASE EVERY READY SUB-ORDER
  =======================================================

  Unlike the old single-seller settlement, this releases
  EVERY sub-order that's AT_BIASHNET — not just one. A
  sub-order that's already RELEASED (e.g. resolved earlier
  via the accept-partial decision) is skipped by
  releaseSubOrder()'s own idempotency check; one that's
  NON_COMPLIANT/REFUNDED/CANCELLED is skipped here since
  releasing it would be wrong (it was already resolved the
  other way).

  A failure releasing one sub-order must not stop the
  others — money for a compliant seller should not be
  held hostage by an unrelated failure.
  =======================================================
  */

  const releasable =
    subOrders.filter(
      (subOrder) =>
        subOrder.status ===
        SUB_ORDER_STATUS.AT_BIASHNET
    );

  const settlements = [];

  const settlementErrors = [];

  for (
    const subOrder
    of releasable
  ) {

    try {

      const settled =
        await releaseSubOrder(
          subOrder.subOrderId
        );

      settlements.push(
        settled
      );

    } catch (settlementError) {

      console.error(
        "❌ Sub-order settlement failed:",
        subOrder.subOrderId,
        settlementError
      );

      settlementErrors.push({

        subOrderId:
          subOrder.subOrderId,

        message:
          settlementError.message,

      });

    }

  }


  /*
  =====================================================
  RECORD OUTCOME ON THE ORDER
  =====================================================

  IMPORTANT

  ORDER IS COMPLETED regardless of settlement outcome —
  the buyer has confirmed delivery. Payment remains safe;
  any sub-order that failed to release stays AT_BIASHNET
  (not RELEASED) so it can be retried, it just isn't lost.
  =====================================================
  */

  const settlementStatus =
    settlementErrors.length === 0
      ? "COMPLETED"
      : (
        settlements.length > 0
          ? "PARTIALLY_COMPLETED"
          : "PENDING"
      );

  await orderRef.update({

    settlementStatus,

    settlementCompletedAt:
      FieldValue.serverTimestamp(),

    settlementError:
      settlementErrors.length > 0
        ? JSON.stringify(
          settlementErrors
        )
        : null,

    updatedAt:
      FieldValue.serverTimestamp(),

  });


  console.log(
    settlementErrors.length === 0
      ? "✅ All sub-order settlements completed:"
      : "⚠️ Some sub-order settlements failed:",
    orderId,
    {
      settled:
        settlements.length,
      failed:
        settlementErrors.length,
    }
  );


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

    confirmedBy,

    status:
      ORDER_STATUS.COMPLETED,

    completionCodeVerified:
      true,

    settlementStatus,

    settlements,

    settlementErrors,

    message:
      settlementErrors.length === 0
        ? "Order completed successfully and every seller settlement was processed."
        : "Order completed. Some seller settlements failed and will need to be retried.",

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