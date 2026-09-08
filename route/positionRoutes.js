const express = require("express");

const router = express.Router();

const { create, list, update } = require("../controller/positionController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
POSITION ROUTES
=========================================================

Base path: /api/positions

POST /            HR or Admin — create a position
GET  /            Any authenticated employee — list positions
PATCH /:positionId HR or Admin — update a position
=========================================================
*/

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
    list
);

router.patch(
    "/:positionId",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("hr", "admin"),
    update
);


module.exports = router;
