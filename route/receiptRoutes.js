const express = require("express");

const router =
  express.Router();

const {
  getReceipt,
} = require("../controller/receiptController");

const {
  requireAuth,
} = require("../middleware/authMiddleware");


router.get(
  "/:orderId",
  requireAuth,
  getReceipt
);


module.exports = router;