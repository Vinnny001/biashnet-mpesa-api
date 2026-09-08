const {
    db,
    FieldValue,
} = require("../config/firebase");

const { FINANCE_COLLECTIONS } = require("../config/financeCollections");

const {
    FINANCE_TRANSACTION_STATUS,
    FINANCE_OWNER_TYPES,
} = require("../config/financeConstants");

const {
    lockFinanceWithdrawal,
    completeFinanceWithdrawal,
    restoreFailedFinanceWithdrawal,
} = require("./financeWalletService");

const { generateWithdrawalId } = require("../utils/codeGenerator");

const { normalizePhone, validatePhone, initiateB2CPayment } = require("./darajaService");


/*
=========================================================
FINANCE WITHDRAWAL SERVICE
=========================================================

Withdrawals from financeWalletAccounts (employees,
investors). Mirrors service/withdrawalService.js's
lock -> B2C -> complete/restore state machine, but is a
fully separate implementation against financeWalletAccounts
so the live seller withdrawal path is never touched.

Uses the SAME darajaService.initiateB2CPayment() utility
(not a collection) with a dedicated resultUrl so its
callback lands on a separate route
(/api/webhooks/mpesa/finance-b2c) instead of the
marketplace's B2C callback handler.
=========================================================
*/

const MIN_FINANCE_WITHDRAWAL_AMOUNT = 10;


function getWithdrawalRef(withdrawalId) {

    return db.collection(FINANCE_COLLECTIONS.FINANCE_WITHDRAWALS).doc(withdrawalId);

}


async function createFinanceWithdrawal({ ownerId, ownerType, amount, phoneNumber }) {

    if (!ownerId) {

        throw new Error("Owner ID is required.");

    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount < MIN_FINANCE_WITHDRAWAL_AMOUNT) {

        throw new Error(`Minimum withdrawal amount is KES ${MIN_FINANCE_WITHDRAWAL_AMOUNT}.`);
    }

    const phone = normalizePhone(phoneNumber);

    if (!validatePhone(phone)) {

        throw new Error("Enter a valid Kenyan M-Pesa number, e.g. 0712345678.");

    }

    const withdrawalId = generateWithdrawalId();

    await lockFinanceWithdrawal({ ownerId, amount: numericAmount, withdrawalId });

    const withdrawalRef = getWithdrawalRef(withdrawalId);

    await withdrawalRef.set({

        withdrawalId,

        ownerId,

        ownerType: ownerType || FINANCE_OWNER_TYPES.EMPLOYEE,

        amount: Number(numericAmount.toFixed(2)),

        currency: "KES",

        phone,

        status: FINANCE_TRANSACTION_STATUS.PENDING,

        createdAt: FieldValue.serverTimestamp(),

        updatedAt: FieldValue.serverTimestamp(),

    });

    const resultUrl =
        (process.env.FINANCE_B2C_RESULT_URL) ||
        undefined;

    try {

        const b2cResponse = await initiateB2CPayment({

            phone,

            amount: numericAmount,

            withdrawalId,

            remarks: `BIASHNET finance withdrawal ${withdrawalId}`,

            resultUrl,

        });

        await withdrawalRef.update({

            status: "PROCESSING",

            conversationId: b2cResponse?.ConversationID || null,

            originatorConversationId: b2cResponse?.OriginatorConversationID || null,

            updatedAt: FieldValue.serverTimestamp(),

        });

    } catch (error) {

        await restoreFailedFinanceWithdrawal({
            ownerId,
            amount: numericAmount,
            withdrawalId,
        });

        await withdrawalRef.update({

            status: FINANCE_TRANSACTION_STATUS.FAILED,

            error: error.message,

            updatedAt: FieldValue.serverTimestamp(),

        });

        throw error;

    }

    const snap = await withdrawalRef.get();

    return { id: withdrawalRef.id, ...snap.data() };

}


async function getFinanceWithdrawal(withdrawalId, ownerId) {

    const snap = await getWithdrawalRef(withdrawalId).get();

    if (!snap.exists) {

        return null;

    }

    const data = snap.data();

    if (ownerId && data.ownerId !== ownerId) {

        return null;

    }

    return { id: snap.id, ...data };

}


async function getOwnerFinanceWithdrawals(ownerId) {

    const snapshot = await db
        .collection(FINANCE_COLLECTIONS.FINANCE_WITHDRAWALS)
        .where("ownerId", "==", ownerId)
        .get();

    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

}


/* ========================================================
   B2C CALLBACK HANDLING
======================================================== */

async function completeFinanceWithdrawalFromCallback({ withdrawalId, success, receiptNumber }) {

    const withdrawalRef = getWithdrawalRef(withdrawalId);

    const snap = await withdrawalRef.get();

    if (!snap.exists) {

        throw new Error("Finance withdrawal not found.");

    }

    const withdrawal = snap.data();

    if (success) {

        await completeFinanceWithdrawal({

            ownerId: withdrawal.ownerId,

            amount: withdrawal.amount,

            withdrawalId,

        });

        await withdrawalRef.update({

            status: FINANCE_TRANSACTION_STATUS.COMPLETED,

            receiptNumber: receiptNumber || null,

            updatedAt: FieldValue.serverTimestamp(),

        });

    } else {

        await restoreFailedFinanceWithdrawal({

            ownerId: withdrawal.ownerId,

            amount: withdrawal.amount,

            withdrawalId,

        });

        await withdrawalRef.update({

            status: FINANCE_TRANSACTION_STATUS.FAILED,

            updatedAt: FieldValue.serverTimestamp(),

        });

    }

    return { withdrawalId, status: success ? "COMPLETED" : "FAILED" };

}


module.exports = {

    createFinanceWithdrawal,

    getFinanceWithdrawal,

    getOwnerFinanceWithdrawals,

    completeFinanceWithdrawalFromCallback,

    MIN_FINANCE_WITHDRAWAL_AMOUNT,

};
