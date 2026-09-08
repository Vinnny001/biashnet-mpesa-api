const {
    createPosition,
    listPositions,
    updatePosition,
} = require("../service/positionService");


/*
=========================================================
POSITION CONTROLLER
=========================================================
*/

async function create(req, res) {

    try {

        const employeeId = req.employee?.id;

        const position = await createPosition({

            ...req.body,

            createdBy: employeeId,

        });

        return res.status(201).json({ success: true, position });

    } catch (error) {

        console.error("❌ Create position controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to create position.",

        });

    }

}


async function list(req, res) {

    try {

        const positions = await listPositions();

        return res.status(200).json({ success: true, positions });

    } catch (error) {

        console.error("❌ List positions controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to list positions.",

        });

    }

}


async function update(req, res) {

    try {

        const { positionId } = req.params;

        const position = await updatePosition(positionId, req.body);

        return res.status(200).json({ success: true, position });

    } catch (error) {

        console.error("❌ Update position controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to update position.",

        });

    }

}


module.exports = { create, list, update };
