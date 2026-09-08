const { createExpense, listExpenses } = require("../service/expenseService");


/*
=========================================================
EXPENSE CONTROLLER
=========================================================
*/

async function create(req, res) {

    try {

        const expense = await createExpense({

            ...req.body,

            recordedBy: req.employee.id,

        });

        return res.status(201).json({ success: true, expense });

    } catch (error) {

        console.error("❌ Create expense controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to record expense.",

        });

    }

}


async function list(req, res) {

    try {

        const { status, category } = req.query;

        const expenses = await listExpenses({ status, category });

        return res.status(200).json({ success: true, expenses });

    } catch (error) {

        console.error("❌ List expenses controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to list expenses.",

        });

    }

}


module.exports = { create, list };
