const PDFDocument = require("pdfkit");


/*
=========================================================
RECEIPT PDF SERVICE
=========================================================

Renders a marketplaceReceipts document (see
receiptService.js) as a PDF, streamed directly to the
HTTP response — no buffering the whole file in memory.
=========================================================
*/

function formatMoney(value, currency = "KES") {

  const number =
    Number(value || 0);

  return `${currency} ${number.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

}


function formatDate(value) {

  if (!value) {

    return "—";

  }

  const date =
    value?.toDate
      ? value.toDate()
      : value?.seconds
        ? new Date(Number(value.seconds) * 1000)
        : new Date(value);

  if (Number.isNaN(date.getTime())) {

    return "—";

  }

  return date.toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });

}


function streamReceiptPdf(receipt, res) {

  const doc =
    new PDFDocument({
      size: "A4",
      margin: 50,
    });

  doc.pipe(res);


  /*
  -------------------------------------------------------
  HEADER
  -------------------------------------------------------
  */

  doc
    .fontSize(20)
    .fillColor("#0F766E")
    .text("BIASHNET", { continued: false });

  doc
    .fontSize(12)
    .fillColor("#000000")
    .text("Payment Receipt", { align: "left" });

  doc.moveDown(1);

  doc
    .fontSize(10)
    .fillColor("#555555")
    .text(`Receipt No: ${receipt.receiptNumber || receipt.receiptId}`)
    .text(`Order ID: ${receipt.orderId}`)
    .text(`Date paid: ${formatDate(receipt.paidAt)}`);

  doc.moveDown(1);
  doc.strokeColor("#DDDDDD").moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);


  /*
  -------------------------------------------------------
  BUYER
  -------------------------------------------------------
  */

  doc
    .fontSize(11)
    .fillColor("#000000")
    .text("Billed to", { underline: true });

  doc
    .fontSize(10)
    .fillColor("#333333")
    .text(receipt.buyerPhone || "—");

  doc.moveDown(1);


  /*
  -------------------------------------------------------
  ITEMS TABLE
  -------------------------------------------------------
  */

  const items =
    Array.isArray(receipt.items)
      ? receipt.items
      : [];

  const tableTop =
    doc.y;

  doc
    .fontSize(10)
    .fillColor("#000000")
    .text("Item", 50, tableTop, { width: 260 })
    .text("Qty", 320, tableTop, { width: 40, align: "right" })
    .text("Unit price", 370, tableTop, { width: 80, align: "right" })
    .text("Total", 460, tableTop, { width: 85, align: "right" });

  doc.moveDown(0.5);
  doc.strokeColor("#DDDDDD").moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.3);

  items.forEach((item) => {

    const rowTop =
      doc.y;

    doc
      .fontSize(10)
      .fillColor("#333333")
      .text(item.title || "Product", 50, rowTop, { width: 260 })
      .text(String(item.quantity || 1), 320, rowTop, { width: 40, align: "right" })
      .text(formatMoney(item.unitPrice, receipt.currency), 370, rowTop, { width: 80, align: "right" })
      .text(formatMoney(item.itemTotal, receipt.currency), 460, rowTop, { width: 85, align: "right" });

    doc.moveDown(0.6);

  });

  doc.moveDown(0.5);
  doc.strokeColor("#DDDDDD").moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);


  /*
  -------------------------------------------------------
  TOTALS
  -------------------------------------------------------
  */

  function totalLine(label, value, { bold = false } = {}) {

    doc
      .fontSize(bold ? 12 : 10)
      .fillColor("#000000")
      .text(label, 370, doc.y, { width: 80, align: "right", continued: true })
      .text(`   ${formatMoney(value, receipt.currency)}`, { width: 95, align: "right" });

    doc.moveDown(0.4);

  }

  totalLine("Subtotal", receipt.subtotal);
  totalLine("Delivery", receipt.deliveryFee);
  doc.moveDown(0.2);
  totalLine("Total paid", receipt.totalPaid, { bold: true });

  doc.moveDown(1.5);


  /*
  -------------------------------------------------------
  PAYMENT DETAILS
  -------------------------------------------------------
  */

  doc
    .fontSize(11)
    .fillColor("#000000")
    .text("Payment details", { underline: true });

  doc
    .fontSize(10)
    .fillColor("#333333")
    .text(`Method: ${receipt.paymentMethod || "MPESA"}`)
    .text(`Transaction ID: ${receipt.providerTransactionId || "—"}`)
    .text(`Status: ${receipt.paymentStatus || "—"}`);

  doc.moveDown(2);


  /*
  -------------------------------------------------------
  FOOTER
  -------------------------------------------------------
  */

  doc
    .fontSize(9)
    .fillColor("#999999")
    .text("Thank you for shopping with Biashnet.", { align: "center" });

  doc.end();

}


module.exports = {

  streamReceiptPdf,

};
