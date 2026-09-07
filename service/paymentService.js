const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");

const {
  PAYMENT_STATUS,
  ORDER_STATUS,
  SELLER_PAYMENT_STATUS,
  PAYOUT_STATUS,
  TRANSACTION_TYPES,
} = require("../config/paymentConstants");

const transactionService =
  require("./transactionService");


  const walletService =
    require("./wallet");


/*
=========================================================
BIASHNET PAYMENT SERVICE
=========================================================

RESPONSIBILITY

This service controls the transition:

M-PESA SUCCESS
      ↓
PAYMENT COMPLETED
      ↓
ORDER PAID
      ↓
STOCK DEDUCTED
      ↓
SELLER FUNDS HELD
      ↓
SELLER PENDING BALANCE CREDITED
      ↓
LEDGER RECORDED

IMPORTANT

Seller funds are NOT available for withdrawal here.

They remain in:

seller wallet.pendingBalance

until:

ORDER COMPLETED
      ↓
settlementService
      ↓
pendingBalance → availableBalance

=========================================================
*/


/*
=========================================================
MONEY
=========================================================
*/

function money(value) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {

    return 0;

  }

  return Number(
    number.toFixed(2)
  );

}


/*
=========================================================
SELLER WALLET
=========================================================
*/

function getSellerWalletRef(
  sellerId
) {

  if (!sellerId) {

    throw new Error(
      "Seller ID is required for wallet."
    );

  }

  return db
    .collection(
      COLLECTIONS.WALLETS
    )
    .doc(
      sellerId
    );

}


/*
=========================================================
CREATE PAYMENT
=========================================================
*/

async function createPayment({

  paymentId,

  orderId,

  buyerId,

  amount,

  phoneNumber,

  paymentMethod = "MPESA",

}) {

  if (!paymentId) {

    throw new Error(
      "Payment ID is required."
    );

  }

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

  const numericAmount =
    Number(amount);

  if (
    !Number.isFinite(
      numericAmount
    ) ||
    numericAmount <= 0
  ) {

    throw new Error(
      "Invalid payment amount."
    );

  }

  const paymentRef =
    db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(
        paymentId
      );

  const existing =
    await paymentRef.get();

  if (
    existing.exists
  ) {

    return {

      created:
        false,

      paymentId,

      ...existing.data(),

    };

  }

  const now =
    FieldValue.serverTimestamp();

  await paymentRef.set({

    paymentId,

    orderId,

    buyerId,

    amount:
      money(
        numericAmount
      ),

    currency:
      "KES",

    paymentMethod:
      String(
        paymentMethod
      ).toUpperCase(),

    provider:
      "MPESA",

    phoneNumber:
      phoneNumber || null,

    status:
      PAYMENT_STATUS.PENDING,

    providerTransactionId:
      null,

    checkoutRequestID:
      null,

    merchantRequestID:
      null,

    resultCode:
      null,

    resultDescription:
      null,

    providerResponse:
      null,

    createdAt:
      now,

    updatedAt:
      now,

  });

  return {

    created:
      true,

    paymentId,

  };

}


/*
=========================================================
GET PAYMENT
=========================================================
*/

async function getPayment(
  paymentId
) {

  if (!paymentId) {

    throw new Error(
      "Payment ID is required."
    );

  }

  const snap =
    await db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(
        paymentId
      )
      .get();

  if (
    !snap.exists
  ) {

    return null;

  }

  return {

    paymentId:
      snap.id,

    ...snap.data(),

  };

}


/*
=========================================================
GET PAYMENT BY CHECKOUT REQUEST
=========================================================
*/

async function getPaymentByCheckoutRequestID(
  checkoutRequestID
) {

  if (!checkoutRequestID) {

    throw new Error(
      "CheckoutRequestID is required."
    );

  }

  const snapshot =
    await db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .where(
        "checkoutRequestID",
        "==",
        checkoutRequestID
      )
      .limit(1)
      .get();

  if (
    snapshot.empty
  ) {

    return null;

  }

  const paymentDoc =
    snapshot.docs[0];

  return {

    paymentId:
      paymentDoc.id,

    ...paymentDoc.data(),

  };

}


/*
=========================================================
ATTACH M-PESA REQUEST
=========================================================
*/

async function attachMpesaRequest({

  paymentId,

  checkoutRequestID,

  merchantRequestID,

}) {

  if (!paymentId) {

    throw new Error(
      "Payment ID is required."
    );

  }

  if (!checkoutRequestID) {

    throw new Error(
      "CheckoutRequestID is required."
    );

  }

  const paymentRef =
    db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(
        paymentId
      );

  await paymentRef.update({

    checkoutRequestID,

    merchantRequestID:
      merchantRequestID ||
      null,

    status:
      PAYMENT_STATUS.PENDING,

    updatedAt:
      FieldValue.serverTimestamp(),

  });

  return getPayment(
    paymentId
  );

}


/*
=========================================================
VALIDATE PAYMENT AMOUNT
=========================================================
*/

function validatePaymentAmount({

  expectedAmount,

  receivedAmount,

}) {

  const expected =
    Number(
      expectedAmount
    );

  const received =
    Number(
      receivedAmount
    );

  if (
    !Number.isFinite(expected) ||
    !Number.isFinite(received)
  ) {

    throw new Error(
      "Invalid payment amount."
    );

  }

  if (
    Math.abs(
      expected -
      received
    ) > 0.01
  ) {

    throw new Error(
      `Payment amount mismatch. Expected KES ${expected}, received KES ${received}.`
    );

  }

  return true;

}


/*
=========================================================
NORMALIZE SELLER BREAKDOWN
=========================================================
*/

function normalizeSellerBreakdown(
  order
) {

  if (
    !Array.isArray(
      order.sellerBreakdown
    ) ||
    !order.sellerBreakdown.length
  ) {

    throw new Error(
      "Order has no seller breakdown."
    );

  }

  return order.sellerBreakdown.map(
    seller => {

      if (!seller?.sellerId) {

        throw new Error(
          "Seller breakdown contains no seller ID."
        );

      }

      const gross =
        money(
          seller.grossAmount ??
          seller.sellerGross ??
          0
        );

      const commission =
        money(
          seller.commissionAmount ??
          0
        );

      const net =
        money(
          seller.sellerNet ??
          (gross - commission)
        );

      if (
        gross < 0 ||
        commission < 0 ||
        net < 0
      ) {

        throw new Error(
          `Invalid seller financial values for ${seller.sellerId}.`
        );

      }

      const calculated =
        money(
          gross - commission
        );

      if (
        calculated !== net
      ) {

        throw new Error(
          `Seller financial mismatch for ${seller.sellerId}.`
        );

      }

      return {

        ...seller,

        sellerId:
          String(
            seller.sellerId
          ),

        grossAmount:
          gross,

        commissionAmount:
          commission,

        sellerNet:
          net,

        sellerPaymentStatus:
          SELLER_PAYMENT_STATUS.HELD,

        payoutStatus:
          PAYOUT_STATUS.NOT_RELEASED,

        settlementStatus:
          "PENDING_COMPLETION",

      };

    }
  );

}


/*
=========================================================
PROCESS MARKETPLACE PAYMENT
=========================================================

THIS IS THE CORE PAYMENT SUCCESS TRANSACTION.

M-PESA SUCCESS
      ↓
validate
      ↓
payment COMPLETED
      ↓
order PAID
      ↓
stock deducted
      ↓
seller pending credited
      ↓
financial ledger written
=========================================================
*/

async function processMarketplacePayment({

  orderId,

  providerTransactionId,

  amount,

  paymentMethod =
    "MPESA",

  providerResponse =
    null,

}) {

  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }

  if (!providerTransactionId) {

    throw new Error(
      "M-PESA receipt number is required."
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

  let result;

  await db.runTransaction(
    async transaction => {

      /*
      ===================================================
      READ ORDER
      ===================================================
      */

      const orderSnap =
        await transaction.get(
          orderRef
        );

      if (
        !orderSnap.exists
      ) {

        throw new Error(
          "Marketplace order not found."
        );

      }

      const order =
        orderSnap.data();


      /*
      ===================================================
      ORDER PAYMENT
      ===================================================
      */

      if (!order.paymentId) {

        throw new Error(
          "Order has no payment record."
        );

      }


      const paymentRef =
        db
          .collection(
            COLLECTIONS.PAYMENTS
          )
          .doc(
            order.paymentId
          );


      /*
      ===================================================
      READ PAYMENT
      ===================================================
      */

      const paymentSnap =
        await transaction.get(
          paymentRef
        );

      if (
        !paymentSnap.exists
      ) {

        throw new Error(
          "Marketplace payment not found."
        );

      }

      const payment =
        paymentSnap.data();


      /*
      ===================================================
      DUPLICATE CALLBACK PROTECTION
      ===================================================
      */

      if (
        payment.status ===
        PAYMENT_STATUS.COMPLETED
      ) {

        result = {

          success:
            true,

          alreadyProcessed:
            true,

          orderId,

          paymentId:
            payment.paymentId,

          amount:
            payment.amount,

          providerTransactionId:
            payment.providerTransactionId,

          status:
            PAYMENT_STATUS.COMPLETED,

        };

        return;

      }


      /*
      ===================================================
      PAYMENT OWNERSHIP
      ===================================================
      */

      if (
        payment.orderId !==
        orderId
      ) {

        throw new Error(
          "Payment does not belong to this order."
        );

      }


      if (
        payment.buyerId !==
        order.buyerId
      ) {

        throw new Error(
          "Payment buyer does not match order buyer."
        );

      }


      /*
      ===================================================
      AMOUNT
      ===================================================
      */

      validatePaymentAmount({

        expectedAmount:
          payment.amount,

        receivedAmount:
          amount,

      });


      /*
      ===================================================
      PAYMENT METHOD
      ===================================================
      */

      if (
        String(
          paymentMethod
        ).toUpperCase() !==
        "MPESA"
      ) {

        throw new Error(
          "Unsupported payment method."
        );

      }


      /*
      ===================================================
      SELLER BREAKDOWN
      ===================================================
      */

      const sellerBreakdown =
        normalizeSellerBreakdown(
          order
        );


      /*
      ===================================================
      ORDER FINANCIALS
      ===================================================
      */

      const buyerTotal =
        money(
          order.buyerTotal
        );

      const sellerGrossTotal =
        money(
          sellerBreakdown.reduce(
            (
              total,
              seller
            ) =>
              total +
              seller.grossAmount,
            0
          )
        );

      const commissionTotal =
        money(
          sellerBreakdown.reduce(
            (
              total,
              seller
            ) =>
              total +
              seller.commissionAmount,
            0
          )
        );

      const sellerNetTotal =
        money(
          sellerBreakdown.reduce(
            (
              total,
              seller
            ) =>
              total +
              seller.sellerNet,
            0
          )
        );

      const deliveryFee =
        money(
          order.deliveryFee
        );


      /*
      Buyer total must equal:
      
      seller gross + delivery
      */

      const calculatedBuyerTotal =
        money(
          sellerGrossTotal +
          deliveryFee
        );


      if (
        calculatedBuyerTotal !==
        buyerTotal
      ) {

        throw new Error(
          `Order financial mismatch. Buyer total ${buyerTotal}, calculated ${calculatedBuyerTotal}.`
        );

      }


      /*
      Seller gross must equal:
      
      seller net + commission
      */

      if (
        money(
          sellerNetTotal +
          commissionTotal
        ) !==
        sellerGrossTotal
      ) {

        throw new Error(
          "Seller financial breakdown does not balance."
        );

      }


      /*
      ===================================================
      READ PRODUCTS
      ===================================================
      */

      const productReads =
        [];


      for (
        const item
        of order.items || []
      ) {

        if (
          !item?.listingId
        ) {

          throw new Error(
            "Order item has no listingId."
          );

        }

        const productRef =
          db
            .collection(
              COLLECTIONS.PRODUCTS
            )
            .doc(
              item.listingId
            );

        const snapshot =
          await transaction.get(
            productRef
          );

        if (
          !snapshot.exists
        ) {

          throw new Error(
            `Product ${item.listingId} no longer exists.`
          );

        }

        productReads.push({

          ref:
            productRef,

          snapshot,

          item,

        });

      }


      /*
      ===================================================
      STOCK VALIDATION
      ===================================================
      */

      for (
        const product
        of productReads
      ) {

        const data =
          product.snapshot.data();

        const stock =
          Number(
            data.stock
          );

        const quantity =
          Number(
            product.item.quantity
          );

        if (
          !Number.isInteger(stock) ||
          stock < 0
        ) {

          throw new Error(
            `Invalid stock for ${product.item.listingId}.`
          );

        }

        if (
          !Number.isInteger(quantity) ||
          quantity <= 0
        ) {

          throw new Error(
            `Invalid quantity for ${product.item.listingId}.`
          );

        }

        if (
          stock < quantity
        ) {

          throw new Error(
            `Insufficient stock for ${product.item.title}.`
          );

        }

      }


      /*
      ===================================================
      DEDUCT STOCK
      ===================================================
      */

      for (
        const product
        of productReads
      ) {

        const data =
          product.snapshot.data();

        const quantity =
          Number(
            product.item.quantity
          );

        transaction.update(

          product.ref,

          {

            stock:
              Number(data.stock) -
              quantity,

            updatedAt:
              FieldValue.serverTimestamp(),

          }

        );

      }


      /*
      ===================================================
      CREDIT SELLER PENDING BALANCE
      ===================================================

      IMPORTANT:

      availableBalance DOES NOT increase.

      */

      for (
    const walletData
    of walletReads
) {

    const seller =
        walletData.seller;

    const operation =
        walletService.holdSellerFundsInTransaction({

            transaction,

            sellerId:
                seller.sellerId,

            amount:
                seller.sellerNet,

            orderId,

            paymentId:
                payment.paymentId,

        });

    await operation.read();

}

      /*
      ===================================================
      PAYMENT LEDGER
      ===================================================
      */

      if (
        !marketplaceLedgerSnap.exists
      ) {

        transaction.create(

          marketplaceLedgerRef,

          {

            transactionId:
              marketplaceLedgerRef.id,

            type:
              TRANSACTION_TYPES.PAYMENT,

            orderId,

            paymentId:
              payment.paymentId,

            buyerId:
              order.buyerId,

            amount:
              buyerTotal,

            currency:
              "KES",

            status:
              PAYMENT_STATUS.COMPLETED,

            direction:
              "CREDIT",

            source:
              "MPESA_MARKETPLACE",

            provider:
              "MPESA",

            providerTransactionId,

            description:
              `Marketplace payment received for order ${orderId}`,

            createdAt:
              FieldValue.serverTimestamp(),

            completedAt:
              FieldValue.serverTimestamp(),

          }

        );

      }


      /*
      ===================================================
      SELLER HOLD LEDGERS
      ===================================================
      */

      for (
        const holder
        of sellerHoldRefs
      ) {

        if (
          holder.snapshot.exists
        ) {

          continue;

        }

        const seller =
          holder.seller;


        transaction.create(

          holder.ref,

          {

            transactionId:
              holder.ref.id,

            type:
              TRANSACTION_TYPES.SELLER_HOLD,

            orderId,

            paymentId:
              payment.paymentId,

            sellerId:
              seller.sellerId,

            buyerId:
              order.buyerId,

            amount:
              seller.sellerNet,

            saleAmount:
              seller.grossAmount,

            commissionAmount:
              seller.commissionAmount,

            sellerGross:
              seller.grossAmount,

            sellerNet:
              seller.sellerNet,

            currency:
              "KES",

            status:
              PAYMENT_STATUS.COMPLETED,

            direction:
              "CREDIT",

            balanceType:
              "PENDING",

            source:
              "MARKETPLACE_ORDER",

            description:
              `Seller funds held for order ${orderId}`,

            createdAt:
              FieldValue.serverTimestamp(),

          }

        );

      }


      /*
      ===================================================
      COMMISSION LEDGER
      ===================================================

      One commission ledger per SELLER.

      */

      for (
        const seller
        of sellerBreakdown
      ) {

        if (
          seller.commissionAmount <= 0
        ) {

          continue;

        }

        const commissionRef =
          db
            .collection(
              COLLECTIONS.TRANSACTIONS
            )
            .doc(
              `COMMISSION_${orderId}_${seller.sellerId}`
            );


        const commissionSnap =
          await transaction.get(
            commissionRef
          );


        if (
          !commissionSnap.exists
        ) {

          transaction.create(

            commissionRef,

            {

              transactionId:
                commissionRef.id,

              type:
                TRANSACTION_TYPES.COMMISSION_ACCRUAL,

              orderId,

              paymentId:
                payment.paymentId,

              sellerId:
                seller.sellerId,

              buyerId:
                order.buyerId,

              amount:
                seller.commissionAmount,

              currency:
                "KES",

              status:
                PAYMENT_STATUS.COMPLETED,

              direction:
                "CREDIT",

              recipient:
                "BIASHNET",

              wallet:
                "COMPANY_WALLET",

              source:
                "MARKETPLACE_ORDER",

              description:
                `BIASHNET commission for seller ${seller.sellerId} on order ${orderId}`,

              createdAt:
                FieldValue.serverTimestamp(),

            }

          );

        }

      }


      /*
      ===================================================
      COMPLETE PAYMENT
      ===================================================
      */

      const now =
        FieldValue.serverTimestamp();


      transaction.update(

        paymentRef,

        {

          status:
            PAYMENT_STATUS.COMPLETED,

          providerTransactionId,

          resultCode:
            0,

          resultDescription:
            "Payment completed.",

          providerResponse,

          completedAt:
            now,

          updatedAt:
            now,

        }

      );


      /*
      ===================================================
      UPDATE ORDER
      ===================================================
      */

      transaction.update(

        orderRef,

        {

          paymentStatus:
            PAYMENT_STATUS.COMPLETED,

          status:
            ORDER_STATUS.PAID,

          paymentId:
            payment.paymentId,

          providerTransactionId,

          fundsReceived:
            true,

          fundsHeld:
            true,

          fundsReleased:
            false,

          sellerPaymentStatus:
            SELLER_PAYMENT_STATUS.HELD,

          payoutStatus:
            PAYOUT_STATUS.NOT_RELEASED,

          sellerBreakdown,

          stockStatus:
            "DEDUCTED",

          paymentCompletedAt:
            now,

          settlementStatus:
            "PENDING_COMPLETION",

          updatedAt:
            now,

        }

      );


      /*
      ===================================================
      RESULT
      ===================================================
      */

      result = {

        success:
          true,

        alreadyProcessed:
          false,

        orderId,

        paymentId:
          payment.paymentId,

        amount:
          payment.amount,

        providerTransactionId,

        status:
          PAYMENT_STATUS.COMPLETED,

        orderStatus:
          ORDER_STATUS.PAID,

        sellerFundsStatus:
          SELLER_PAYMENT_STATUS.HELD,

        settlementStatus:
          "PENDING_COMPLETION",

        totalSellerNet:
          sellerNetTotal,

        totalCommission:
          commissionTotal,

      };

    }
  );


  console.log(
    "=========================================="
  );

  console.log(
    "✅ BIASHNET MARKETPLACE PAYMENT PROCESSED"
  );

  console.log(
    result
  );

  console.log(
    "=========================================="
  );


  return result;

}


/*
=========================================================
MARK PAYMENT SUCCESSFUL
=========================================================
*/

async function markPaymentSuccessful({

  paymentId,

  providerTransactionId,

  amount,

  resultCode = 0,

  resultDescription = "",

  providerResponse = null,

}) {

  const payment =
    await getPayment(
      paymentId
    );

  if (!payment) {

    throw new Error(
      "Payment not found."
    );

  }

  return processMarketplacePayment({

    orderId:
      payment.orderId,

    providerTransactionId,

    amount,

    paymentMethod:
      payment.paymentMethod,

    providerResponse: {

      ...providerResponse,

      ResultCode:
        resultCode,

      ResultDesc:
        resultDescription,

    },

  });

}


/*
=========================================================
MARK PAYMENT FAILED
=========================================================
*/

async function markPaymentFailed({

  paymentId,

  resultCode,

  resultDescription,

  providerResponse = null,

}) {

  if (!paymentId) {

    throw new Error(
      "Payment ID is required."
    );

  }

  const paymentRef =
    db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(
        paymentId
      );

  const paymentSnap =
    await paymentRef.get();

  if (
    !paymentSnap.exists
  ) {

    throw new Error(
      "Payment not found."
    );

  }

  const payment =
    paymentSnap.data();


  if (
    payment.status ===
    PAYMENT_STATUS.COMPLETED
  ) {

    return {

      success:
        true,

      alreadyCompleted:
        true,

      paymentId,

    };

  }


  const now =
    FieldValue.serverTimestamp();


  await paymentRef.update({

    status:
      PAYMENT_STATUS.FAILED,

    resultCode,

    resultDescription,

    providerResponse,

    failedAt:
      now,

    updatedAt:
      now,

  });


  if (
    payment.orderId
  ) {

    const orderRef =
      db
        .collection(
          COLLECTIONS.ORDERS
        )
        .doc(
          payment.orderId
        );

    const orderSnap =
      await orderRef.get();

    if (
      orderSnap.exists
    ) {

      const order =
        orderSnap.data();


      if (
        order.paymentStatus !==
        PAYMENT_STATUS.COMPLETED
      ) {

        await orderRef.update({

          paymentStatus:
            PAYMENT_STATUS.FAILED,

          status:
            ORDER_STATUS.PENDING_PAYMENT,

          fundsReceived:
            false,

          fundsHeld:
            false,

          fundsReleased:
            false,

          updatedAt:
            now,

        });

      }

    }

  }


  return {

    success:
      true,

    paymentId,

    orderId:
      payment.orderId,

    status:
      PAYMENT_STATUS.FAILED,

  };

}


/*
=========================================================
CALCULATE PAYMENT BREAKDOWN
=========================================================
*/

async function calculatePaymentBreakdown({

  amount,

  category,

}) {

  const {
    calculateCommission,
  } =
    require("./commissionService");


  return calculateCommission({

    amount,

    category,

  });

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

  createPayment,

  getPayment,

  getPaymentByCheckoutRequestID,

  attachMpesaRequest,

  validatePaymentAmount,

  processMarketplacePayment,

  markPaymentSuccessful,

  markPaymentFailed,

  calculatePaymentBreakdown,

};