const {
    confirmDropoff,
    listPendingDropoffs,
    getSubOrder,
    getSubOrdersForOrder,
} = require("../service/logisticsService");


/*
=========================================================
LOGISTICS CONTROLLER
=========================================================
*/

async function listPending(req, res) {

    try {

        const subOrders =
            await listPendingDropoffs();

        return res.status(200).json({

            success: true,

            subOrders,

        });

    } catch (error) {

        console.error(
            "❌ List pending drop-offs controller error:",
            error
        );

        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to list pending drop-offs.",

        });

    }

}


async function confirm(req, res) {

    try {

        const { subOrderId } = req.params;

        const result =
            await confirmDropoff({

                subOrderId,

                confirmedBy:
                    req.employee.id,

            });

        return res.status(200).json({ success: true, ...result });

    } catch (error) {

        console.error(
            "❌ Confirm drop-off controller error:",
            error
        );

        return res.status(
            error.statusCode || 400
        ).json({

            success: false,

            message:
                error.message ||
                "Unable to confirm drop-off.",

        });

    }

}


async function getOne(req, res) {

    try {

        const { subOrderId } = req.params;

        const subOrder =
            await getSubOrder(subOrderId);

        if (!subOrder) {

            return res.status(404).json({

                success: false,

                message:
                    "Sub-order not found.",

            });

        }

        return res.status(200).json({ success: true, subOrder });

    } catch (error) {

        console.error(
            "❌ Get sub-order controller error:",
            error
        );

        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve sub-order.",

        });

    }

}


async function listForOrder(req, res) {

    try {

        const { orderId } = req.params;

        const subOrders =
            await getSubOrdersForOrder(orderId);

        return res.status(200).json({ success: true, subOrders });

    } catch (error) {

        console.error(
            "❌ List sub-orders for order controller error:",
            error
        );

        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to list sub-orders.",

        });

    }

}


module.exports = {

    listPending,

    confirm,

    getOne,

    listForOrder,

};
