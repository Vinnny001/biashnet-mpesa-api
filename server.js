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
const publicSellerRoutes = require("./route/publicSellerRoutes");
const receiptRoutes =
  require("./route/receiptRoutes");

const orderCompletionRoutes =
  require("./route/orderCompletionRoutes");

/*
=========================================================
FINANCE DOMAIN ROUTES (Employees/HR/Payroll/Expenses/
Investor ledger/Loans) — see plan doc in
.claude/plans (or README) for full context. All additive.
=========================================================
*/

const employeeRoutes =
  require("./route/employeeRoutes");

const positionRoutes =
  require("./route/positionRoutes");

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

const companyInfoRoutes =
  require("./route/companyInfoRoutes");

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

app.use("/api/employees", employeeRoutes);

app.use("/api/positions", positionRoutes);

app.use("/api/expenses", expenseRoutes);

app.use("/api/approvals", approvalRoutes);

app.use("/api/payroll", payrollRoutes);

app.use("/api/finance-withdrawals", financeWithdrawalRoutes);

app.use("/api/investors", investorLedgerRoutes);

app.use("/api/loans", loanRouter);

app.use("/api/lenders", lenderRouter);

app.use("/api/company-info", companyInfoRoutes);

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