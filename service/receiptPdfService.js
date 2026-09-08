const path = require("path");
const PDFDocument = require("pdfkit");

const LOGO_PATH =
  path.join(__dirname, "..", "assets", "logo.jpg");


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
  HEADER (round logo + name/title alongside it)
  -------------------------------------------------------
  */

  const logoSize = 60;
  const headerTop = doc.y;

  try {

    /*
    Clip to a circle before drawing — the source image is
    a square file, this crops it to a round badge instead
    of showing its square corners.
    */

    doc.save();

    doc
      .circle(
        50 + logoSize / 2,
        headerTop + logoSize / 2,
        logoSize / 2
      )
      .clip();

    doc.image(
      LOGO_PATH,
      50,
      headerTop,
      { width: logoSize, height: logoSize }
    );

    doc.restore();

  } catch {

    /*
    Missing/unreadable logo file must never break receipt
    generation — fall back to text-only header. restore()
    still needs to run so the clip doesn't leak onto the
    rest of the page.
    */

    doc.restore();

  }

  doc
    .fontSize(20)
    .fillColor("#0F766E")
    .text("BIASHNET", 50 + logoSize + 15, headerTop + 6);

  doc
    .fontSize(12)
    .fillColor("#000000")
    .text("Payment Receipt", 50 + logoSize + 15, headerTop + 32);

  doc.x = 50;
  doc.y = headerTop + logoSize + 10;

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

  Row height is measured from the actual title text
  (which can wrap to more than one line) instead of a
  fixed increment, so a long product name can never
  overlap the row below it.
  -------------------------------------------------------
  */

  const items =
    Array.isArray(receipt.items)
      ? receipt.items
      : [];

  const COL = {

    item: { x: 50, width: 260 },

    qty: { x: 320, width: 40 },

    unitPrice: { x: 370, width: 80 },

    total: { x: 460, width: 85 },

  };

  const tableTop =
    doc.y;

  doc
    .fontSize(10)
    .fillColor("#000000")
    .text("Item", COL.item.x, tableTop, { width: COL.item.width })
    .text("Qty", COL.qty.x, tableTop, { width: COL.qty.width, align: "right" })
    .text("Unit price", COL.unitPrice.x, tableTop, { width: COL.unitPrice.width, align: "right" })
    .text("Total", COL.total.x, tableTop, { width: COL.total.width, align: "right" });

  doc.moveDown(0.5);
  doc.strokeColor("#DDDDDD").moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.3);

  items.forEach((item) => {

    const rowTop =
      doc.y;

    const title =
      item.title || "Product";

    const rowHeight =
      Math.max(
        doc.heightOfString(title, { width: COL.item.width, fontSize: 10 }),
        14
      );

    doc
      .fontSize(10)
      .fillColor("#333333")
      .text(title, COL.item.x, rowTop, { width: COL.item.width })
      .text(String(item.quantity || 1), COL.qty.x, rowTop, { width: COL.qty.width, align: "right" })
      .text(formatMoney(item.unitPrice, receipt.currency), COL.unitPrice.x, rowTop, { width: COL.unitPrice.width, align: "right" })
      .text(formatMoney(item.itemTotal, receipt.currency), COL.total.x, rowTop, { width: COL.total.width, align: "right" });

    doc.x = 50;
    doc.y = rowTop + rowHeight + 6;

  });

  doc.strokeColor("#DDDDDD").moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);


  /*
  -------------------------------------------------------
  TOTALS

  Label and value are two independent, non-continued
  text calls sharing one y — combining pdfkit's
  `continued` mode with different widths/alignments on
  each half is what caused the overlap.
  -------------------------------------------------------
  */

  function totalLine(label, value, { bold = false } = {}) {

    const rowTop =
      doc.y;

    const fontSize =
      bold ? 12 : 10;

    doc
      .fontSize(fontSize)
      .fillColor("#000000")
      .text(label, 300, rowTop, { width: 150, align: "right" });

    doc
      .fontSize(fontSize)
      .fillColor("#000000")
      .text(formatMoney(value, receipt.currency), 460, rowTop, { width: 85, align: "right" });

    doc.x = 50;
    doc.y = rowTop + fontSize + 8;

  }

  totalLine("Subtotal", receipt.subtotal);
  totalLine("Delivery", receipt.deliveryFee);
  doc.moveDown(0.3);
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
