const {
    createLender,
    listLenders,
    createLoan,
    requestLoanRepayment,
    listLoans,
} = require("../service/loanService");


/*
=========================================================
LOAN / LENDER CONTROLLER
=========================================================
*/

async function createLenderHandler(req, res) {

    try {

        const lender = await createLender({

            ...req.body,

            createdBy: req.employee.id,

        });

        return res.status(201).json({ success: true, lender });

    } catch (error) {

        console.error("❌ Create lender controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to create lender.",

        });

    }

}


async function listLendersHandler(req, res) {

    try {

        const lenders = await listLenders();

        return res.status(200).json({ success: true, lenders });

    } catch (error) {

        console.error("❌ List lenders controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to list lenders.",

        });

    }

}


async function createLoanHandler(req, res) {

    try {

        const loan = await createLoan({

            ...req.body,

            requestedBy: req.employee.id,

        });

        return res.status(201).json({

            success: true,

            message: "Loan disbursement submitted for CEO approval.",

            loan,

        });

    } catch (error) {

        console.error("❌ Create loan controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to create loan.",

        });

    }

}


async function listLoansHandler(req, res) {

    try {

        const loans = await listLoans();

        return res.status(200).json({ success: true, loans });

    } catch (error) {

        console.error("❌ List loans controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to list loans.",

        });

    }

}


async function repayLoan(req, res) {

    try {

        const { loanId } = req.params;

        const { amount } = req.body;

        const result = await requestLoanRepayment({

            loanId,

            amount,

            requestedBy: req.employee.id,

        });

        return res.status(201).json({

            success: true,

            message: "Loan repayment submitted for CEO approval.",

            ...result,

        });

    } catch (error) {

        console.error("❌ Loan repayment controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to submit loan repayment.",

        });

    }

}


module.exports = {

    createLenderHandler,

    listLendersHandler,

    createLoanHandler,

    listLoansHandler,

    repayLoan,

};
