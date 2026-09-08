const {
    createEmployee,
    getEmployee,
    listEmployees,
    updateEmployeeStatus,
    updateEmployeePosition,
    requestRoleChange,
} = require("../service/employeeService");

const { getFinanceWallet } = require("../service/financeWalletService");


/*
=========================================================
EMPLOYEE CONTROLLER
=========================================================
*/

async function me(req, res) {

    try {

        const employeeId = req.employee.id;

        const wallet = await getFinanceWallet(employeeId);

        return res.status(200).json({

            success: true,

            employee: req.employee,

            wallet,

        });

    } catch (error) {

        console.error("❌ Get my employee profile controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to retrieve employee profile.",

        });

    }

}


async function create(req, res) {

    try {

        const employee = await createEmployee({

            ...req.body,

            addedBy: req.employee.id,

        });

        return res.status(201).json({ success: true, employee });

    } catch (error) {

        console.error("❌ Create employee controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to create employee.",

        });

    }

}


async function list(req, res) {

    try {

        const employees = await listEmployees();

        return res.status(200).json({ success: true, employees });

    } catch (error) {

        console.error("❌ List employees controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to list employees.",

        });

    }

}


async function updateStatus(req, res) {

    try {

        const { employeeId } = req.params;

        const { employmentStatus } = req.body;

        const employee = await updateEmployeeStatus(employeeId, employmentStatus);

        return res.status(200).json({ success: true, employee });

    } catch (error) {

        console.error("❌ Update employee status controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to update employee status.",

        });

    }

}


async function updatePosition(req, res) {

    try {

        const { employeeId } = req.params;

        const { positionId } = req.body;

        const employee = await updateEmployeePosition(employeeId, positionId);

        return res.status(200).json({ success: true, employee });

    } catch (error) {

        console.error("❌ Update employee position controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to update employee position.",

        });

    }

}


async function changeRoles(req, res) {

    try {

        const { employeeId } = req.params;

        const { roles } = req.body;

        const request = await requestRoleChange({

            employeeId,

            proposedRoles: roles,

            requestedBy: req.employee.id,

        });

        return res.status(201).json({

            success: true,

            message: "Role change request submitted for CEO approval.",

            request,

        });

    } catch (error) {

        console.error("❌ Request role change controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to submit role change request.",

        });

    }

}


module.exports = {

    me,

    create,

    list,

    updateStatus,

    updatePosition,

    changeRoles,

};
