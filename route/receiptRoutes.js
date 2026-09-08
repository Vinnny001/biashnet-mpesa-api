const express = require("express");

const router =
  express.Router();

const {
  getReceipt,
  listReceipts,
  downloadReceiptPdf,
} = require("../controller/receiptController");

const {
  requireAuth,
} = require("../middleware/auth");


/*
=========================================================
RECEIPT ROUTES
=========================================================

Base path: /api/marketplace/receipts

GET /                  my payment history (all receipts)
GET /:orderId          one receipt
GET /:orderId/pdf      download that receipt as a PDF

/:orderId/pdf MUST come after / — Express won't confuse
it with /:orderId regardless of order (different segment
count), but this keeps the specific-before-generic
convention used elsewhere in this codebase.
=========================================================
*/

router.get(
  "/",
  requireAuth,
  listReceipts
);


router.get(
  "/:orderId/pdf",
  requireAuth,
  downloadReceiptPdf
);


router.get(
  "/:orderId",
  requireAuth,
  getReceipt
);


module.exports = router;
