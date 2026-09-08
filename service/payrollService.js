const {
    db,
} = require("../config/firebase");

const { FINANCE_COLLECTIONS, COMPANY_WALLET_ID } = require("../config/financeCollections");

const {
    APPROVAL_LEVEL,
    APPROVAL_REQUEST_TYPES,
    FINANCE_TRANSACTION_TYPES,
    FINANCE_DIRECTIONS,
    FINANCE_OWNER_TYPES,
    EMPLOYMENT_STATUS,
    PAYROLL_APPROVAL_THRESHOLD,
} = require("../config/financeConstants");

const {
    debitFinanceWallet,
    creditFinanceWallet,
} = require("./financeWalletService");

const { createFinanceTransaction } = require("./financeLedgerService");

const { createApprovalRequest } = require("./approvalService");

const { createNotification } = require("./notificationService");


/*
=========================================================
PAYROLL SERVICE
=========================================================

Stipend payouts credit an employee's financeWalletAccounts
directly into availableBalance (no escrow — payroll isn't
held pending delivery confirmation like marketplace
sales), debiting the company treasury wallet.
=========================================================
*/

async function getEmployeeAndPosition(employeeId) {

    const employeeSnap = await db
        .collection(FINANCE_COLLECTIONS.EMPLOYEES)
        .doc(employeeId)
        .get();

    if (!employeeSnap.exists) {

        throw new Error("Employee not found.");

    }

    const employee = employeeSnap.data();

    if (employee.employmentStatus !== EMPLOYMENT_STATUS.ACTIVE) {

        throw new Error("Employee is not active.");

    }

    const positionSnap = await db
        .collection(FINANCE_COLLECTIONS.POSITIONS)
        .doc(employee.positionId)
        .get();

    if (!positionSnap.exists) {

        throw new Error("Employee position not found.");

    }

    return { employee, position: positionSnap.data() };

}


async function postStipendPayout(employeeId, amount) {

    const period = new Date().toISOString().slice(0, 7);

    const transactionId = `STIPEND_${employeeId}_${period}_${Date.now()}`;

    await debitFinanceWallet({

        ownerId: COMPANY_WALLET_ID,

        ownerType: FINANCE_OWNER_TYPES.PLATFORM,

        amount,

    });

    await creditFinanceWallet({

        ownerId: employeeId,

        ownerType: FINANCE_OWNER_TYPES.EMPLOYEE,

        amount,

        creditType: "balance",

    });

    await createFinanceTransaction({

        transactionId,

        transactionType: FINANCE_TRANSACTION_TYPES.EMPLOYEE_STIPEND,

        amount,

        direction: FINANCE_DIRECTIONS.PAID,

        fromId: COMPANY_WALLET_ID,

        fromType: FINANCE_OWNER_TYPES.PLATFORM,

        toId: employeeId,

        toType: FINANCE_OWNER_TYPES.EMPLOYEE,

        method: "wallet",

        description: `Stipend payout for ${period}`,

        metadata: { period },

    });

    await createNotification(employeeId, {

        title: "Stipend paid",

        message: `Your stipend of KES ${amount} for ${period} has been credited to your wallet.`,

        type: "STIPEND_PAID",

    }).catch(() => {});

    return { employeeId, amount, period, transactionId };

}


async function runStipendPayout({ employeeId, requestedBy }) {

    const { position } = await getEmployeeAndPosition(employeeId);

    const amount = Number(position.stipend);

    if (!Number.isFinite(amount) || amount <= 0) {

        throw new Error("Position stipend is not configured.");

    }

    if (amount < PAYROLL_APPROVAL_THRESHOLD) {

        return await postStipendPayout(employeeId, amount);

    }

    const request = await createApprovalRequest({

        requestType: APPROVAL_REQUEST_TYPES.PAYROLL_RUN,

        requestedBy,

        targetId: employeeId,

        requiredLevel: APPROVAL_LEVEL.CEO,

        payload: { employeeId, amount },

        description: `Stipend payout for ${employeeId} — KES ${amount}`,

    });

    return { queuedForApproval: true, approvalRequest: request };

}


/* ========================================================
   APPLY (called by approvalService on approve)
======================================================== */

async function applyPayrollRun(payload) {

    const { employeeId, amount } = payload;

    return await postStipendPayout(employeeId, amount);

}


async function getPayrollHistory(employeeId) {

    const { getFinanceLedgerForOwner } = require("./financeLedgerService");

    const rows = await getFinanceLedgerForOwner(employeeId);

    return rows.filter(
        (row) => row.transactionType === FINANCE_TRANSACTION_TYPES.EMPLOYEE_STIPEND
    );

}


module.exports = {

    runStipendPayout,

    applyPayrollRun,

    getPayrollHistory,

};
