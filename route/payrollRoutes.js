const express = require("express");

const router = express.Router();

const { run, history } = require("../controller/payrollController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
PAYROLL ROUTES
=========================================================

Base path: /api/payroll

POST /run                     Accountant/Admin — trigger a stipend payout
GET  /history/:employeeId     Accountant/Admin/CEO — payout history
=========================================================
*/

router.post(
    "/run",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin"),
    run
);

router.get(
    "/history/:employeeId",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin", "ceo"),
    history
);


module.exports = router;
