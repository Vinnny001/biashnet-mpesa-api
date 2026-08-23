const {
  getAuth,
} = require("../config/firebase");

const {
  initiateInvestment:
    initiateInvestmentService,
} = require("../service/investmentService");


/*
=========================================================
GET AUTHENTICATED USER
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
    authorization.substring(7);


  return getAuth()
    .verifyIdToken(token);

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
    =========================================
    AUTHENTICATE
    =========================================
    */

    const user =
      await getAuthenticatedUser(req);


    /*
    =========================================
    REQUEST DATA
    =========================================
    */

    const {
      phone,
      amount,
    } = req.body;


    /*
    =========================================
    CALL SERVICE
    =========================================
    */

    const result =
      await initiateInvestmentService({

        userId:
          user.uid,

        phone,

        amount,

      });


    /*
    =========================================
    SUCCESS
    =========================================
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