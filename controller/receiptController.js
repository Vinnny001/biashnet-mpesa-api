const {
  getMarketplaceReceipt,
} = require("../service/receiptService");


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
EXPORT
=========================================================
*/

module.exports = {

  getReceipt,

};