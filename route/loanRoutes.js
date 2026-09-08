const express = require("express");

const router = express.Router();

const {
    createLenderHandler,
    listLendersHandler,
    createLoanHandler,
    listLoansHandler,
    repayLoan,
} = require("../controller/loanController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
LOAN / LENDER ROUTES
=========================================================

Base path: /api/loans (+ /api/lenders, mounted separately)

POST /api/lenders                Accountant/Admin — create a lender
GET  /api/lenders                Accountant/Admin/CEO — list lenders

POST /api/loans                  Accountant — record a disbursement (CEO approval)
GET  /api/loans                  Accountant/Admin/CEO — list loans
POST /api/loans/:loanId/repayments  Accountant — record a repayment (CEO approval)
=========================================================
*/

const lenderRouter = express.Router();

lenderRouter.post(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin"),
    createLenderHandler
);

lenderRouter.get(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin", "ceo"),
    listLendersHandler
);


router.post(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin"),
    createLoanHandler
);

router.get(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin", "ceo"),
    listLoansHandler
);

router.post(
    "/:loanId/repayments",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin"),
    repayLoan
);


module.exports = { loanRouter: router, lenderRouter };
