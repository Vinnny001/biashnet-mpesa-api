const express = require("express");

const router = express.Router();

const {
    me,
    create,
    list,
    updateStatus,
    updatePosition,
    changeRoles,
} = require("../controller/employeeController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
EMPLOYEE ROUTES
=========================================================

Base path: /api/employees

GET   /me                          any employee — own profile + wallet
POST  /                            HR/Admin — link a user as an employee
GET   /                            HR/Admin/CEO — list employees
PATCH /:employeeId/status          HR/Admin — direct, no approval
PATCH /:employeeId/position        HR/Admin — direct, no approval
PATCH /:employeeId/roles           HR — creates a CEO approval request
=========================================================
*/

router.get(
    "/me",
    requireAuth,
    employeeAuth,
    me
);

router.post(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("hr", "admin"),
    create
);

router.get(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("hr", "admin", "ceo"),
    list
);

router.patch(
    "/:employeeId/status",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("hr", "admin"),
    updateStatus
);

router.patch(
    "/:employeeId/position",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("hr", "admin"),
    updatePosition
);

router.patch(
    "/:employeeId/roles",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("hr", "admin"),
    changeRoles
);


module.exports = router;
