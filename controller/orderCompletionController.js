const {
  getBuyerCompletionCode,
  verifyCompletionCode: verifyCompletionCodeService,
} = require("../service/orderCompletionService");


/*
=========================================================
BUYER GET COMPLETION CODE
=========================================================
*/

async function getCompletionCode(
  req,
  res
) {

  try {

    const buyerId =
      req.user.uid;

    const {
      orderId,
    } = req.params;

    /*
    The service takes (orderId, buyerId) positionally and
    returns the code string (or null). This used to pass one
    object and spread the result, so the call always failed
    with "Buyer ID is required." and no buyer could ever see
    their code.
    */

    const code =
      await getBuyerCompletionCode(
        orderId,
        buyerId
      );

    return res.json({

      success: true,

      code:
        code || null,

    });

  } catch (error) {

    console.error(
      "Get completion code error:",
      error
    );

    return res.status(
      error.statusCode || 500
    ).json({

      success: false,

      message:
        error.message ||
        "Unable to retrieve completion code.",

    });

  }

}


/*
=========================================================
LOGISTICS VERIFY COMPLETION CODE

Confirms the FINAL Biashnet -> buyer handoff. Called by
the logistics/supply-chain manager (or admin), not a
seller — sellers confirm their own leg (drop-off at
Biashnet) separately via logisticsController.confirmDropoff.
=========================================================
*/

async function verifyCompletionCode(
  req,
  res
) {

  try {

    const confirmedBy =
      req.employee.id;

    const {
      orderId,
    } = req.params;

    const {
      code,
    } = req.body;

    if (!code) {

      return res.status(400).json({

        success: false,

        message:
          "Completion code is required.",

      });

    }

    const result =
      await verifyCompletionCodeService({

        orderId,

        confirmedBy,

        code,

      });

    return res.json({

      success: true,

      ...result,

    });

  } catch (error) {

    console.error(
      "Verify completion code error:",
      error
    );

    return res.status(
      error.statusCode || 500
    ).json({

      success: false,

      message:
        error.message ||
        "Unable to verify completion code.",

    });

  }

}


module.exports = {

  getCompletionCode,

  verifyCompletionCode,

};