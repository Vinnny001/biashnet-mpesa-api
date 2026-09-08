const { db } = require("../config/firebase");

const { FINANCE_COLLECTIONS } = require("../config/financeCollections");

const {
    completeFinanceWithdrawalFromCallback,
} = require("./financeWithdrawalService");


/*
=========================================================
FINANCE B2C CALLBACK SERVICE
=========================================================

Receives Safaricom B2C callback data for finance
withdrawals (employees/investors), landing on a DEDICATED
route (/api/webhooks/mpesa/finance-b2c) separate from the
marketplace's own B2C callback — so
service/withdrawalCallbackService.js is never touched.

Identifies the withdrawal by the ConversationID /
OriginatorConversationID that was stored on the
financeWithdrawals document when the payout was initiated,
rather than by parsing custom ResultParameters (which
Safaricom does not always echo back).
=========================================================
*/

async function processFinanceB2CCallback(body) {

    const result = body?.Result;

    if (!result) {

        return { handled: false, reason: "INVALID_B2C_CALLBACK" };

    }

    const resultCode = Number(result.ResultCode);

    const conversationId = result.ConversationID || null;

    const originatorConversationId = result.OriginatorConversationID || null;

    const resultParameters = result.ResultParameters?.ResultParameter || [];

    const findParameter = (names = []) => {

        const found = resultParameters.find((item) => names.includes(item.Key));

        return found?.Value ?? null;

    };

    const providerTransactionId =
        result.TransactionID || findParameter(["TransactionID"]);

    if (!conversationId && !originatorConversationId) {

        console.error(
            "❌ Finance B2C callback has no conversation ID:",
            JSON.stringify(body, null, 2)
        );

        return { handled: false, requiresReview: true, reason: "MISSING_CONVERSATION_ID" };

    }

    const snapshot = await db
        .collection(FINANCE_COLLECTIONS.FINANCE_WITHDRAWALS)
        .where("conversationId", "==", conversationId)
        .limit(1)
        .get();

    const doc = !snapshot.empty
        ? snapshot.docs[0]
        : (
            await db
                .collection(FINANCE_COLLECTIONS.FINANCE_WITHDRAWALS)
                .where("originatorConversationId", "==", originatorConversationId)
                .limit(1)
                .get()
        ).docs[0];

    if (!doc) {

        console.error(
            "❌ Finance B2C callback matched no withdrawal:",
            conversationId,
            originatorConversationId
        );

        return { handled: false, requiresReview: true, reason: "WITHDRAWAL_NOT_FOUND" };

    }

    const withdrawalId = doc.id;

    const outcome = await completeFinanceWithdrawalFromCallback({

        withdrawalId,

        success: resultCode === 0,

        receiptNumber: providerTransactionId,

    });

    return { handled: true, ...outcome };

}


module.exports = { processFinanceB2CCallback };
