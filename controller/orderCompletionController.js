const {
  getBuyerCompletionCode,
  verifyOrderCompletionCode,
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

    const result =
      await getBuyerCompletionCode({

        orderId,

        buyerId,

      });

    return res.json({

      success: true,

      ...result,

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
SELLER VERIFY COMPLETION CODE
=========================================================
*/

async function verifyCompletionCode(
  req,
  res
) {

  try {

    const sellerId =
      req.user.uid;

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
      await verifyOrderCompletionCode({

        orderId,

        sellerId,

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