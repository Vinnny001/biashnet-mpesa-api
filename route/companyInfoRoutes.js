const express = require("express");

const router = express.Router();

const { get, update } = require("../controller/companyInfoController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
COMPANY INFO ROUTES
=========================================================

Base path: /api/company-info

GET   /   any authenticated employee
PATCH /   CEO/Admin only
=========================================================
*/

router.get(
    "/",
    requireAuth,
    employeeAuth,
    get
);

router.patch(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("ceo", "admin"),
    update
);


module.exports = router;
