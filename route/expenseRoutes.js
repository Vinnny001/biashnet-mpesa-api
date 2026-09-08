const express = require("express");

const router = express.Router();

const { create, list } = require("../controller/expenseController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
EXPENSE ROUTES
=========================================================

Base path: /api/expenses

POST /   Accountant/Admin — record an expense (auto-posts
         below threshold, otherwise queued for approval)
GET  /   Accountant/Admin/CEO — list expenses
=========================================================
*/

router.post(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin"),
    create
);

router.get(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("accountant", "admin", "ceo"),
    list
);


module.exports = router;
