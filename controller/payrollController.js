const { runStipendPayout, getPayrollHistory } = require("../service/payrollService");


/*
=========================================================
PAYROLL CONTROLLER
=========================================================
*/

async function run(req, res) {

    try {

        const { employeeId } = req.body;

        if (!employeeId) {

            return res.status(400).json({

                success: false,

                message: "employeeId is required.",

            });

        }

        const result = await runStipendPayout({

            employeeId,

            requestedBy: req.employee.id,

        });

        return res.status(201).json({ success: true, ...result });

    } catch (error) {

        console.error("❌ Run payroll controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to run stipend payout.",

        });

    }

}


async function history(req, res) {

    try {

        const { employeeId } = req.params;

        const rows = await getPayrollHistory(employeeId);

        return res.status(200).json({ success: true, history: rows });

    } catch (error) {

        console.error("❌ Payroll history controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to retrieve payroll history.",

        });

    }

}


module.exports = { run, history };
