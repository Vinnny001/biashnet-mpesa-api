const express = require("express");

const router = express.Router();

const { list, approve, reject } = require("../controller/approvalController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
APPROVAL ROUTES
=========================================================

Base path: /api/approvals

GET  /                    Admin/CEO — list pending approvals
POST /:requestId/approve  Admin/CEO — approve (level checked in controller)
POST /:requestId/reject   Admin/CEO — reject
=========================================================
*/

router.get(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("admin", "ceo"),
    list
);

router.post(
    "/:requestId/approve",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("admin", "ceo"),
    approve
);

router.post(
    "/:requestId/reject",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("admin", "ceo"),
    reject
);


module.exports = router;
