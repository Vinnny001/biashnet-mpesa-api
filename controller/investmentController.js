const {
  getAuth,
} = require("../config/firebase");

const {
  initiateInvestment,
} = require("../service/investmentService");


/*
=========================================================
GET AUTHENTICATED USER
=========================================================

Frontend sends:

Authorization:
Bearer FIREBASE_ID_TOKEN

The backend verifies the Firebase token and obtains
the real userId from Firebase.

NEVER trust userId sent by the frontend.

=========================================================
*/

async function getAuthenticatedUser(req) {

  const authorization =
    req.headers.authorization || "";


  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {

    const error =
      new Error(
        "Authentication token is required."
      );

    error.statusCode = 401;

    throw error;

  }


  const token =
    authorization.substring(7).trim();


  if (!token) {

    const error =
      new Error(
        "Authentication token is required."
      );

    error.statusCode = 401;

    throw error;

  }


  try {

    const decoded =
      await getAuth()
        .verifyIdToken(token);

    return decoded;

  } catch (error) {

    const authError =
      new Error(
        "Invalid or expired authentication token."
      );

    authError.statusCode = 401;

    throw authError;

  }

}


/*
=========================================================
PHONE NORMALIZATION
=========================================================

The service also validates the phone.

This controller-level validation is only to reject
obviously invalid input early.

The service remains authoritative.

=========================================================
*/

function normalizePhone(phone) {

  const cleaned =
    String(phone || "")
      .replace(/\D/g, "");


  /*
  07XXXXXXXX
  */

  if (
    cleaned.startsWith("07") &&
    cleaned.length === 10
  ) {

    return (
      "254" +
      cleaned.slice(1)
    );

  }


  /*
  01XXXXXXXX
  */

  if (
    cleaned.startsWith("01") &&
    cleaned.length === 10
  ) {

    return (
      "254" +
      cleaned.slice(1)
    );

  }


  /*
  254XXXXXXXXX
  */

  if (
    cleaned.startsWith("254") &&
    cleaned.length === 12
  ) {

    return cleaned;

  }


  return null;

}


/*
=========================================================
INITIATE INVESTMENT
=========================================================
*/

async function initiateInvestment(
  req,
  res
) {

  try {

    /*
    =====================================================
    1. AUTHENTICATE FIREBASE USER
    =====================================================
    */

    const user =
      await getAuthenticatedUser(req);


    const userId =
      user.uid;


    /*
    =====================================================
    2. READ REQUEST
    =====================================================
    */

    const {
      phone,
      amount,
    } =
      req.body || {};


    /*
    =====================================================
    3. BASIC AMOUNT VALIDATION
    =====================================================
    */

    if (
      amount === undefined ||
      amount === null ||
      amount === ""
    ) {

      return res.status(400).json({

        success: false,

        message:
          "Investment amount is required.",

      });

    }


    const investmentAmount =
      Number(amount);


    if (
      !Number.isFinite(
        investmentAmount
      ) ||
      investmentAmount < 1
    ) {

      return res.status(400).json({

        success: false,

        message:
          "Investment amount must be at least KES 1.",

      });

    }


    /*
    =====================================================
    4. BASIC PHONE VALIDATION
    =====================================================
    */

    const normalizedPhone =
      normalizePhone(phone);


    if (!normalizedPhone) {

      return res.status(400).json({

        success: false,

        message:
          "Enter a valid Kenyan M-Pesa phone number.",

      });

    }


    /*
    =====================================================
    5. INITIATE INVESTMENT
    =====================================================

    All actual business logic now belongs to the service.

    The service will:

    - verify investor
    - verify investor status
    - normalize phone
    - validate amount
    - create pending transaction
    - call Daraja
    - save CheckoutRequestID
    - return STK information

    =====================================================
    */

    const result =
      await initiateInvestment({

        userId,

        phone:
          normalizedPhone,

        amount:
          investmentAmount,

      });


    /*
    =====================================================
    6. SUCCESS RESPONSE
    =====================================================
    */

    return res.status(200).json({

      success: true,

      message:
        result.message ||
        "Investment STK Push sent successfully.",

      userId,

      phone:
        result.phone ||
        normalizedPhone,

      amount:
        result.amount ||
        investmentAmount,

      pendingTransactionId:
        result.pendingTransactionId ||
        null,

      checkoutRequestID:
        result.checkoutRequestID ||
        null,

      merchantRequestID:
        result.merchantRequestID ||
        null,

      status:
        result.status ||
        "STK_SENT",

    });

  } catch (error) {

    console.error(
      "❌ Investment initiation error:",
      error
    );


    /*
    =====================================================
    STATUS CODE
    =====================================================

    Services can provide their own statusCode.

    Otherwise default to 500.
    =====================================================
    */

    const statusCode =
      Number(
        error.statusCode
      ) || 500;


    return res.status(
      statusCode
    ).json({

      success: false,

      message:
        error.message ||
        "Failed to initiate investment.",

    });

  }

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  initiateInvestment,

};