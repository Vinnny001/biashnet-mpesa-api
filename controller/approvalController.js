const {
    listPendingApprovals,
    getApprovalRequest,
    approveRequest,
    rejectRequest,
} = require("../service/approvalService");

const { APPROVAL_REQUEST_TYPES } = require("../config/financeConstants");

const { applyExpensePosting } = require("../service/expenseService");
const { applyPayrollRun } = require("../service/payrollService");
const { applyLoanEntry } = require("../service/loanService");
const { applyInvestorPayout } = require("../service/investorLedgerService");


/*
=========================================================
APPROVAL CONTROLLER
=========================================================

One generic queue, one generic approve/reject endpoint.
Each requestType maps to the domain service function that
knows how to actually apply it.
=========================================================
*/

const APPLY_HANDLERS = {

    [APPROVAL_REQUEST_TYPES.EXPENSE]: applyExpensePosting,

    [APPROVAL_REQUEST_TYPES.PAYROLL_RUN]: applyPayrollRun,

    [APPROVAL_REQUEST_TYPES.LOAN_ENTRY]: applyLoanEntry,

    [APPROVAL_REQUEST_TYPES.INVESTOR_PAYOUT]: applyInvestorPayout,

};


async function list(req, res) {

    try {

        const { requiredLevel } = req.query;

        const approvals = await listPendingApprovals({ requiredLevel });

        return res.status(200).json({ success: true, approvals });

    } catch (error) {

        console.error("❌ List approvals controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to list approval requests.",

        });

    }

}


async function approve(req, res) {

    try {

        const { requestId } = req.params;

        const request = await getApprovalRequest(requestId);

        if (!request) {

            return res.status(404).json({

                success: false,

                message: "Approval request not found.",

            });

        }

        const applyFn = APPLY_HANDLERS[request.requestType];

        if (!applyFn) {

            return res.status(400).json({

                success: false,

                message: `No handler is registered for request type ${request.requestType}.`,

            });

        }

        const roles = req.employee.roles || {};

        const isCeo = roles.ceo === true || roles.admin === true;

        const isAdminLevel = roles.admin === true || roles.ceo === true;

        const authorizedForLevel =
            request.requiredLevel === "CEO" ? isCeo : isAdminLevel;

        if (!authorizedForLevel) {

            return res.status(403).json({

                success: false,

                message: `This request requires ${request.requiredLevel} approval.`,

            });

        }

        const result = await approveRequest(requestId, req.employee.id, applyFn);

        return res.status(200).json({ success: true, ...result });

    } catch (error) {

        console.error("❌ Approve request controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to approve request.",

        });

    }

}


async function reject(req, res) {

    try {

        const { requestId } = req.params;

        const { reason } = req.body;

        const result = await rejectRequest(requestId, req.employee.id, reason);

        return res.status(200).json({ success: true, ...result });

    } catch (error) {

        console.error("❌ Reject request controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to reject request.",

        });

    }

}


module.exports = { list, approve, reject };
