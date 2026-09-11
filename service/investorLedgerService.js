const {
    FINANCE_COLLECTIONS,
    COMPANY_WALLET_ID,
    financeWalletId,
} = require("../config/financeCollections");

const {
    APPROVAL_LEVEL,
    APPROVAL_REQUEST_TYPES,
    FINANCE_TRANSACTION_TYPES,
    FINANCE_DIRECTIONS,
    FINANCE_OWNER_TYPES,
    INVESTOR_PAYOUT_APPROVAL_THRESHOLD,
} = require("../config/financeConstants");

const {
    creditFinanceWallet,
    debitFinanceWallet,
    createFinanceWalletIfNotExists,
} = require("./financeWalletService");

const {
    createFinanceTransaction,
    getFinanceLedgerForOwner,
} = require("./financeLedgerService");

const { createApprovalRequest } = require("./approvalService");

const { createNotification } = require("./notificationService");


/*
=========================================================
INVESTOR LEDGER SERVICE
=========================================================

Additive layer on top of the existing, untouched "investor"
collection and legacy investment payment system. This
service NEVER reads or writes investor/{uid} — it only
references investorId (the same uid used there) to credit
a brand-new financeWalletAccounts document and write rows
to financeTransactionRecords.
=========================================================
*/

async function recordContribution({

    investorId,

    amount,

    providerTransactionId = null,

    metadata = {},

}) {

    if (!investorId) {

        throw new Error("Investor ID is required.");

    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {

        throw new Error("Contribution amount must be greater than zero.");

    }

    await createFinanceWalletIfNotExists(investorId, FINANCE_OWNER_TYPES.INVESTOR);

    await creditFinanceWallet({

        ownerId: investorId,

        ownerType: FINANCE_OWNER_TYPES.INVESTOR,

        amount: numericAmount,

        creditType: "contribution",

    });

    const transactionId = `CONTRIB_${investorId}_${providerTransactionId || Date.now()}`;

    await createFinanceTransaction({

        transactionId,

        transactionType: FINANCE_TRANSACTION_TYPES.INVESTOR_CONTRIBUTION,

        amount: numericAmount,

        direction: FINANCE_DIRECTIONS.RECEIVED,

        fromId: financeWalletId(investorId, FINANCE_OWNER_TYPES.INVESTOR),

        fromType: FINANCE_OWNER_TYPES.INVESTOR,

        toId: COMPANY_WALLET_ID,

        toType: FINANCE_OWNER_TYPES.PLATFORM,

        method: "mpesa",

        reference: providerTransactionId,

        description: "Investor contribution",

        metadata,

    });

    return { investorId, amount: numericAmount, transactionId };

}


async function postInvestorPayout(investorId, amount, approvedBy) {

    await debitFinanceWallet({

        ownerId: investorId,

        ownerType: FINANCE_OWNER_TYPES.INVESTOR,

        amount,

    });

    const transactionId = `PAYOUT_${investorId}_${Date.now()}`;

    await createFinanceTransaction({

        transactionId,

        transactionType: FINANCE_TRANSACTION_TYPES.INVESTOR_PAYOUT,

        amount,

        direction: FINANCE_DIRECTIONS.PAID,

        fromId: COMPANY_WALLET_ID,

        fromType: FINANCE_OWNER_TYPES.PLATFORM,

        toId: financeWalletId(investorId, FINANCE_OWNER_TYPES.INVESTOR),

        toType: FINANCE_OWNER_TYPES.INVESTOR,

        method: "wallet",

        description: "Investor payout",

        metadata: { approvedBy: approvedBy || null },

    });

    await createNotification(investorId, {

        title: "Investor payout recorded",

        message: `A payout of KES ${amount} has been recorded to your investor wallet.`,

        type: "INVESTOR_PAYOUT",

    }).catch(() => {});

    return { investorId, amount, transactionId };

}


async function requestInvestorPayout({ investorId, amount, requestedBy }) {

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {

        throw new Error("Payout amount must be greater than zero.");

    }

    if (numericAmount < INVESTOR_PAYOUT_APPROVAL_THRESHOLD) {

        return await postInvestorPayout(investorId, numericAmount, requestedBy);

    }

    const request = await createApprovalRequest({

        requestType: APPROVAL_REQUEST_TYPES.INVESTOR_PAYOUT,

        requestedBy,

        targetId: investorId,

        requiredLevel: APPROVAL_LEVEL.CEO,

        payload: { investorId, amount: numericAmount },

        description: `Investor payout for ${investorId} — KES ${numericAmount}`,

    });

    return { queuedForApproval: true, approvalRequest: request };

}


/* ========================================================
   APPLY (called by approvalService on approve)
======================================================== */

async function applyInvestorPayout(payload, request) {

    const { investorId, amount } = payload;

    return await postInvestorPayout(investorId, amount, request.approvedBy);

}


async function getInvestorLedger(investorId) {

    /*
    Ledger is scoped to the investor WALLET, not the person — an
    employee-and-investor must not see their payroll in their
    investor ledger.
    */
    return getFinanceLedgerForOwner(
        financeWalletId(investorId, FINANCE_OWNER_TYPES.INVESTOR)
    );

}


module.exports = {

    recordContribution,

    requestInvestorPayout,

    applyInvestorPayout,

    getInvestorLedger,

};
