const express = require("express");
const cors = require("cors");
require("dotenv").config();
const investmentRoutes = require("./route/investmentRoutes");
const checkoutRoutes = require("./route/checkoutRoutes");
const paymentRoutes = require("./route/paymentRoutes");
const orderRoutes = require("./route/orderRoutes");
const withdrawalRoutes = require("./route/withdrawalRoutes");
const webhookRoutes = require("./route/webhookRoutes");
const sellerRoutes = require("./route/sellerRoutes");
const healthRoutes = require("./route/healthRoutes");
const notificationRoutes = require("./route/notificationRoutes");
const publicSellerRoutes = require("./route/publicSellerRoutes");
const receiptRoutes =
  require("./route/receiptRoutes");

const orderCompletionRoutes =
  require("./route/orderCompletionRoutes");

/*
=========================================================
FINANCE DOMAIN ROUTES (Payroll/Expenses/Investor ledger/
Loans/Finance withdrawals) — strictly payments/wallets.
Employees/HR/Positions/Company-info now live natively in
backend; approvalRoutes here only ever resolves the
financial request types (ROLE_CHANGE is backend's).
=========================================================
*/

const expenseRoutes =
  require("./route/expenseRoutes");

const approvalRoutes =
  require("./route/approvalRoutes");

const payrollRoutes =
  require("./route/payrollRoutes");

const financeWithdrawalRoutes =
  require("./route/financeWithdrawalRoutes");

const investorLedgerRoutes =
  require("./route/investorLedgerRoutes");

const { loanRouter, lenderRouter } =
  require("./route/loanRoutes");

/*
=========================================================
LOGISTICS / DELIVERY DOMAIN — per-seller sub-orders,
logistics-managed drop-off confirmation, 36h compliance
sweep, buyer accept-partial/cancel resolution. All additive.
=========================================================
*/

const logisticsRoutes =
  require("./route/logisticsRoutes");

const internalRoutes =
  require("./route/internalRoutes");

const app = express();

app.use(cors());

/*
Health checks first, ahead of every other route and body
parsing — see route/healthRoutes.js.
*/
app.use(healthRoutes);
app.use("/api", healthRoutes);

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);


/*
=========================================================
HEALTH CHECK
=========================================================
*/

app.get("/", (req, res) => {

    res.json({
        success: true,
        app: "Biashnet Payment API",
        status: "LIVE"
    });

});

app.use(
    "/api/seller",
    sellerRoutes
);
app.use(
    "/api/public/sellers",
    publicSellerRoutes
);

app.use(
  "/api/marketplace/receipts",
  receiptRoutes
);

app.use(
  "/api/marketplace/order-completion",
  orderCompletionRoutes
);
/*
=========================================================
MARKETPLACE CHECKOUT
=========================================================
*/

app.use(
    "/api/payments",
    checkoutRoutes
);


/*
=========================================================
MARKETPLACE PAYMENT
=========================================================
*/

app.use(
    "/api/payments",
    paymentRoutes
);


/*
=========================================================
ORDERS
=========================================================
*/

app.use(
    "/api/orders",
    orderRoutes
);


/*
=========================================================
WITHDRAWALS
=========================================================
*/

app.use(
    "/api/withdrawals",
    withdrawalRoutes
);


/*
=========================================================
M-PESA WEBHOOKS
=========================================================
*/

app.use(
    "/api/webhooks",
    webhookRoutes
);

/*
=========================================================
INVESTMENTS
=========================================================
*/

app.use(
    "/api/payments",
    investmentRoutes
);

/*
=========================================================
FINANCE DOMAIN (Employees/HR/Payroll/Expenses/Investor
ledger/Loans)
=========================================================
*/

app.use("/api/expenses", expenseRoutes);

app.use("/api/approvals", approvalRoutes);

app.use("/api/payroll", payrollRoutes);

app.use("/api/finance-withdrawals", financeWithdrawalRoutes);

app.use("/api/investors", investorLedgerRoutes);

app.use("/api/loans", loanRouter);

app.use("/api/lenders", lenderRouter);

/*
=========================================================
LOGISTICS / DELIVERY (sub-orders, drop-off confirmation,
compliance sweep)
=========================================================
*/

app.use("/api/logistics", logisticsRoutes);

app.use("/api/internal", internalRoutes);


/*
=========================================================
NOTIFICATIONS

Order-lifecycle notifications for buyers and sellers.
=========================================================
*/

app.use("/api/notifications", notificationRoutes);

/*
=========================================================
ERROR HANDLER
=========================================================
*/

app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).json({
        success: false,
        message:
            err.message ||
            "Internal server error."
    });

});


/*
=========================================================
START
=========================================================
*/

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {

        console.log(
            `🚀 Biashnet backend running on port ${PORT}`
        );

    }
);