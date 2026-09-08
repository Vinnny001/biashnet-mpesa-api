const express = require("express");

const router = express.Router();

const { ledger, payout } = require("../controller/investorLedgerController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
INVESTOR LEDGER ROUTES
=========================================================

Base path: /api/investors

GET  /:investorId/ledger    any authenticated user viewing
                             their own ledger, or Accountant/
                             Admin/CEO viewing any investor
POST /:investorId/payouts   Accountant/Admin/CEO — record a payout
=========================================================
*/

router.get(
    "/:investorId/ledger",
    requireAuth,
    (req, res, next) => {

        if (req.user?.uid === req.params.investorId) {

            return next();

        }

        return employeeAuth(req, res, () =>
            requireEmployeeRole("accountant", "admin", "ceo")(req, res, next)
        );

    },
    ledger
);

router.post(
    "/:investorId/payouts",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin", "ceo"),
    payout
);


module.exports = router;
