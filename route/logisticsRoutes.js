const express = require("express");

const router = express.Router();

const {
    listPending,
    confirm,
    listReady,
    dispatchOrder,
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
GET  /ready-for-delivery          logistics/admin — every seller dropped off
POST /orders/:orderId/out-for-delivery         logistics/admin — dispatch
GET  /sub-orders/:subOrderId      logistics/admin — one sub-order
POST /sub-orders/:subOrderId/confirm-dropoff   logistics/admin
GET  /orders/:orderId/sub-orders  logistics/admin — all sub-orders for an order

The delivery run is therefore: confirm each seller's
drop-off, dispatch the order once they are all in, then
verify the buyer's completion code on handover (that last
step lives in order-completion, because it releases funds).
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
    "/ready-for-delivery",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("logistics", "admin"),
    listReady
);

router.post(
    "/orders/:orderId/out-for-delivery",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("logistics", "admin"),
    dispatchOrder
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
