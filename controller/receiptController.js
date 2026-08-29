const {
  getMarketplaceReceipt,
} = require("../service/receiptService");


async function getReceipt(req, res) {

  try {

    const buyerId =
      req.user.uid;

    const {
      orderId,
    } = req.params;

    if (!orderId) {

      return res.status(400).json({
        success: false,
        message: "Order ID is required.",
      });

    }

    const receipt =
      await getMarketplaceReceipt({
        orderId,
        buyerId,
      });

    if (!receipt) {

      return res.status(404).json({
        success: false,
        message: "Receipt not found.",
      });

    }

    return res.json({

      success: true,

      receipt,

    });

  } catch (error) {

    console.error(
      "Get marketplace receipt error:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Unable to retrieve receipt.",

    });

  }

}


module.exports = {
  getReceipt,
};