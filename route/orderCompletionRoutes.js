const express = require("express");

const router =
  express.Router();

const {
  getCompletionCode,
  verifyCompletionCode,
} = require("../controller/orderCompletionController");

const {
  requireAuth,
} = require("../middleware/auth");

const {
  employeeAuth,
} = require("../middleware/employeeAuth");

const {
  requireEmployeeRole,
} = require("../middleware/requireEmployeeRole");


/*
=========================================================
BUYER
=========================================================
*/

router.get(
  "/:orderId/code",
  requireAuth,
  getCompletionCode
);


/*
=========================================================
LOGISTICS / ADMIN

Confirms the final Biashnet -> buyer handoff. IMPORTANT:
this is what actually releases seller funds, so it must
stay restricted to logistics/admin — never plain
requireAuth.
=========================================================
*/

router.post(
  "/:orderId/verify",
  requireAuth,
  employeeAuth,
  requireEmployeeRole("logistics", "admin"),
  verifyCompletionCode
);


module.exports = router;