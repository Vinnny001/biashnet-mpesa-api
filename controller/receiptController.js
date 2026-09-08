const {
  getMarketplaceReceipt,
  listMarketplaceReceipts,
} = require("../service/receiptService");

const {
  streamReceiptPdf,
} = require("../service/receiptPdfService");


/*
=========================================================
GET MARKETPLACE RECEIPT
=========================================================

GET

/api/orders/:orderId/receipt

AUTHENTICATION:

Firebase Authentication
        ↓
req.user.uid
        ↓
buyerId

IMPORTANT:

NEVER accept buyerId from:

- req.body
- req.query
- req.params

The authenticated Firebase UID is the buyer identity.
=========================================================
*/

async function getReceipt(req, res) {

  try {

    /*
    =====================================================
    AUTHENTICATED BUYER
    =====================================================
    */

    const buyerId =
      req.user?.uid;


    if (!buyerId) {

      return res.status(401).json({

        success: false,

        message:
          "Authentication required.",

      });

    }


    /*
    =====================================================
    ORDER ID
    =====================================================
    */

    const orderId =
      req.params?.orderId;


    if (!orderId) {

      return res.status(400).json({

        success: false,

        message:
          "Order ID is required.",

      });

    }


    /*
    =====================================================
    GET RECEIPT
    =====================================================
    */

    const receipt =
      await getMarketplaceReceipt(

        String(orderId).trim(),

        String(buyerId).trim(),

      );


    /*
    =====================================================
    RECEIPT NOT FOUND
    =====================================================
    */

    if (!receipt) {

      return res.status(404).json({

        success: false,

        message:
          "Receipt not found.",

      });

    }


    /*
    =====================================================
    SUCCESS
    =====================================================
    */

    return res.status(200).json({

      success: true,

      receipt,

    });

  } catch (error) {

    console.error(
      "Get marketplace receipt error:",
      error
    );


    /*
    =====================================================
    STATUS CODE
    =====================================================
    */

    const statusCode =
      Number.isInteger(
        error?.statusCode
      )
        ? error.statusCode
        : 400;


    /*
    =====================================================
    ERROR RESPONSE
    =====================================================
    */

    return res.status(
      statusCode
    ).json({

      success: false,

      message:
        error?.message ||
        "Unable to retrieve receipt.",

    });

  }

}


/*
=========================================================
LIST MY RECEIPTS (PAYMENT HISTORY)
=========================================================

GET

/api/marketplace/receipts
=========================================================
*/

async function listReceipts(req, res) {

  try {

    const buyerId =
      req.user?.uid;


    if (!buyerId) {

      return res.status(401).json({

        success: false,

        message:
          "Authentication required.",

      });

    }


    const receipts =
      await listMarketplaceReceipts(
        buyerId
      );


    return res.status(200).json({

      success: true,

      receipts,

    });

  } catch (error) {

    console.error(
      "List marketplace receipts error:",
      error
    );

    return res.status(400).json({

      success: false,

      message:
        error?.message ||
        "Unable to retrieve payment history.",

    });

  }

}


/*
=========================================================
DOWNLOAD RECEIPT PDF
=========================================================

GET

/api/marketplace/receipts/:orderId/pdf
=========================================================
*/

async function downloadReceiptPdf(req, res) {

  try {

    const buyerId =
      req.user?.uid;


    if (!buyerId) {

      return res.status(401).json({

        success: false,

        message:
          "Authentication required.",

      });

    }


    const orderId =
      req.params?.orderId;


    if (!orderId) {

      return res.status(400).json({

        success: false,

        message:
          "Order ID is required.",

      });

    }


    const receipt =
      await getMarketplaceReceipt(

        String(orderId).trim(),

        String(buyerId).trim(),

      );


    if (!receipt) {

      return res.status(404).json({

        success: false,

        message:
          "Receipt not found.",

      });

    }


    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="biashnet-receipt-${orderId}.pdf"`
    );

    streamReceiptPdf(
      receipt,
      res
    );

  } catch (error) {

    console.error(
      "Download receipt PDF error:",
      error
    );

    const statusCode =
      Number.isInteger(
        error?.statusCode
      )
        ? error.statusCode
        : 400;

    return res.status(
      statusCode
    ).json({

      success: false,

      message:
        error?.message ||
        "Unable to generate receipt PDF.",

    });

  }

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  getReceipt,

  listReceipts,

  downloadReceiptPdf,

};