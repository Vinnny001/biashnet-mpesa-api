const {
  admin,
} = require("../config/firebase");

const {
  initiateInvestment:
    initiateInvestmentService,
} = require("../service/investmentService");


/*
=========================================================
GET AUTHENTICATED USER
=========================================================

Frontend sends:

Authorization:
Bearer FIREBASE_ID_TOKEN

Firebase Admin verifies the token.

=========================================================
*/

async function getAuthenticatedUser(req) {

  const authorization =
    req.headers.authorization || "";


  /*
  =======================================================
  AUTHORIZATION HEADER
  =======================================================
  */

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


  /*
  =======================================================
  EXTRACT TOKEN
  =======================================================
  */

  const token =
    authorization.substring(7).trim();


  if (!token) {

    const error =
      new Error(
        "Authentication token is missing."
      );

    error.statusCode = 401;

    throw error;

  }


  /*
  =======================================================
  VERIFY FIREBASE TOKEN
  =======================================================
  */

  try {

    return await admin
      .auth()
      .verifyIdToken(token);

  } catch (error) {

    console.error(
      "❌ Firebase authentication failed:",
      error.message
    );

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
    1. AUTHENTICATE USER
    =====================================================
    */

    const user =
      await getAuthenticatedUser(req);


    /*
    =====================================================
    2. REQUEST DATA
    =====================================================
    */

    const {
      phone,
      amount,
    } = req.body || {};


    /*
    =====================================================
    3. CALL INVESTMENT SERVICE
    =====================================================
    */

    const result =
      await initiateInvestmentService({

        userId:
          user.uid,

        phone,

        amount,

      });


    /*
    =====================================================
    4. SUCCESS RESPONSE
    =====================================================
    */

    return res.status(200).json({

      success: true,

      message:
        result.message,

      userId:
        user.uid,

      phone:
        result.phone,

      amount:
        result.amount,

      checkoutRequestID:
        result.checkoutRequestID,

      merchantRequestID:
        result.merchantRequestID,

      pendingTransactionId:
        result.pendingTransactionId,

      status:
        result.status,

    });

  } catch (error) {

    console.error(
      "❌ Investment initiation error:",
      error
    );


    const statusCode =
      error.statusCode || 500;


    return res
      .status(statusCode)
      .json({

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