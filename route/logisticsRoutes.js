const express = require("express");

const router = express.Router();

const {
    listPending,
    confirm,
    getOne,
    listForOrder,
} = require("../controller/logisticsController");

const { requireAuth } = require("../middleware/auth");

const { employeeAuth } = require("../middleware/employeeAuth");

const { requireEmployeeRole } = require("../middleware/requireEmployeeRole");


/*
=========================================================
LOGISTICS ROUTES
=========================================================

Base path: /api/logistics

GET  /pending-dropoffs            logistics/admin — dashboard list
GET  /sub-orders/:subOrderId      logistics/admin — one sub-order
POST /sub-orders/:subOrderId/confirm-dropoff   logistics/admin
GET  /orders/:orderId/sub-orders  logistics/admin — all sub-orders for an order
=========================================================
*/

router.get(
    "/pending-dropoffs",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("logistics", "admin"),
    listPending
);

router.get(
    "/sub-orders/:subOrderId",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("logistics", "admin"),
    getOne
);

router.post(
    "/sub-orders/:subOrderId/confirm-dropoff",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("logistics", "admin"),
    confirm
);

router.get(
    "/orders/:orderId/sub-orders",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("logistics", "admin"),
    listForOrder
);


module.exports = router;
