const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");

const {
    PAYOUT_STATUS,
    PAYMENT_METHODS,
    PAYMENT_PROVIDERS,
} = require("../config/paymentConstants");

const {
    createWithdrawal,
    markWithdrawalProcessing,
    failWithdrawal,
} = require("./withdrawalService");

/*
IMPORTANT:

This must match the actual B2C function exported
by your darajaService.js.

Expected shape:

initiateB2CPayment({
    phone,
    amount,
    withdrawalId,
    remarks,
    occasion,
})
*/
const {
    initiateB2CPayment,
} = require("./darajaService");


/*
=========================================================
MONEY
=========================================================
*/

function toMoney(value) {

    const amount =
        Number(value);

    if (!Number.isFinite(amount)) {

        throw new Error(
            "Invalid monetary amount."
        );

    }

    return Number(
        amount.toFixed(2)
    );

}


/*
=========================================================
NORMALIZE PHONE
=========================================================
*/

function normalizePhone(phone) {

    let value =
        String(phone || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "");

    /*
    +2547XXXXXXXX
    +2541XXXXXXXX
    */
    if (
        value.startsWith("+254")
    ) {

        value =
            value.substring(1);

    }

    /*
    07XXXXXXXX
    01XXXXXXXX
    */
    if (
        /^(07|01)\d{8}$/.test(value)
    ) {

        value =
            "254" +
            value.substring(1);

    }

    /*
    7XXXXXXXX
    1XXXXXXXX
    */
    if (
        /^[17]\d{8}$/.test(value)
    ) {

        value =
            "254" +
            value;

    }

    return value;

}


/*
=========================================================
VALIDATE PHONE
=========================================================
*/

function validatePhone(phone) {

    return /^254[17]\d{8}$/.test(
        phone
    );

}


/*
=========================================================
GET WITHDRAWAL
=========================================================
*/

async function getWithdrawal(
    withdrawalId
) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }

    const ref =
        db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .doc(
                withdrawalId
            );

    const snap =
        await ref.get();

    if (!snap.exists) {

        return null;

    }

    return {

        id:
            snap.id,

        ...snap.data(),

    };

}


/*
=========================================================
SAVE B2C PROVIDER REQUEST
=========================================================

Stores the fact that BIASHNET attempted a B2C payout.

This does NOT move money.

Money was already locked by withdrawalService.
=========================================================
*/

async function saveB2CRequest({
    withdrawalId,
    provider,
    request,
}) {

    const withdrawalRef =
        db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .doc(
                withdrawalId
            );

    await withdrawalRef.update({

        b2cRequest: {

            provider:
                provider || "MPESA",

            commandId:
                request?.CommandID ||
                request?.commandId ||
                "BusinessPayment",

            responseCode:
                request?.ResponseCode ??
                request?.responseCode ??
                null,

            responseDescription:
                request?.ResponseDescription ||
                request?.responseDescription ||
                null,

            conversationId:
                request?.ConversationID ||
                request?.conversationId ||
                null,

            originatorConversationId:
                request?.OriginatorConversationID ||
                request?.originatorConversationId ||
                null,

            requestedAt:
                FieldValue.serverTimestamp(),

        },

        updatedAt:
            FieldValue.serverTimestamp(),

    });

}


/*
=========================================================
INITIATE B2C WITHDRAWAL
=========================================================

FLOW:

Seller
  ↓
createWithdrawal()
  ↓
AVAILABLE → WITHDRAWAL LOCK
  ↓
withdrawals/{id}
  ↓
Daraja B2C
  ↓
Safaricom accepts request
  ↓
markWithdrawalProcessing()
  ↓
PROCESSING
  ↓
Safaricom callback
  ↓
withdrawalCallbackService
  ↓
COMPLETE / FAIL
=========================================================
*/

async function initiateB2CWithdrawal({

    userId,

    amount,

    phoneNumber,

    withdrawalId = null,

}) {

    /*
    =====================================================
    1. BASIC VALIDATION
    =====================================================
    */

    if (!userId) {

        throw new Error(
            "Seller ID is required."
        );

    }

    const withdrawalAmount =
        toMoney(amount);

    if (
        withdrawalAmount <= 0
    ) {

        throw new Error(
            "Withdrawal amount must be greater than zero."
        );

    }


    /*
    =====================================================
    2. NORMALIZE PHONE
    =====================================================
    */

    const phone =
        normalizePhone(
            phoneNumber
        );

    if (
        !validatePhone(phone)
    ) {

        throw new Error(
            "Enter a valid Kenyan M-Pesa number, e.g. 0712345678 or 0112345678."
        );

    }


    /*
    =====================================================
    3. CREATE / FIND WITHDRAWAL
    =====================================================

    createWithdrawal():

    availableBalance
        ↓
    withdrawalBalance
        ↓
    withdrawal PENDING

    This is the financial lock.
    */

    let withdrawal;

    if (
        withdrawalId
    ) {

        withdrawal =
            await getWithdrawal(
                withdrawalId
            );

        if (!withdrawal) {

            throw new Error(
                "Withdrawal request not found."
            );

        }

        if (
            withdrawal.userId !==
            userId
        ) {

            throw new Error(
                "Withdrawal does not belong to this seller."
            );

        }

    } else {

        const created =
            await createWithdrawal({

                userId,

                amount:
                    withdrawalAmount,

                phoneNumber:
                    phone,

            });

        withdrawal =
            await getWithdrawal(
                created.withdrawalId
            );

    }


    /*
    =====================================================
    4. IDEMPOTENCY
    =====================================================

    Never send another B2C request when one is already
    processing or completed.
    */

    if (
        withdrawal.status ===
        PAYOUT_STATUS.COMPLETED
    ) {

        return {

            success: true,

            alreadyCompleted: true,

            withdrawalId:
                withdrawal.withdrawalId,

            amount:
                withdrawal.amount,

            status:
                PAYOUT_STATUS.COMPLETED,

        };

    }


    if (
        withdrawal.status ===
        PAYOUT_STATUS.PROCESSING
    ) {

        return {

            success: true,

            alreadyProcessing: true,

            withdrawalId:
                withdrawal.withdrawalId,

            amount:
                withdrawal.amount,

            status:
                PAYOUT_STATUS.PROCESSING,

        };

    }


    if (
        withdrawal.status ===
        PAYOUT_STATUS.FAILED
    ) {

        throw new Error(
            "This withdrawal has already failed."
        );

    }


    /*
    =====================================================
    5. CONFIRM CANONICAL DATA
    =====================================================
    */

    const finalAmount =
        toMoney(
            withdrawal.amount
        );

    const finalPhone =
        normalizePhone(
            withdrawal.phone || phone
        );

    if (
        !validatePhone(finalPhone)
    ) {

        throw new Error(
            "Withdrawal contains an invalid M-Pesa phone number."
        );

    }


    /*
    =====================================================
    6. SEND B2C TO SAFARICOM
    =====================================================

    NOTE:

    This service does NOT contain:

    ConsumerKey
    ConsumerSecret
    SecurityCredential
    ShortCode

    Those belong in darajaService.js.
    */

    let providerResponse;

    try {

        providerResponse =
            await initiateB2CPayment({

                phone:
                    finalPhone,

                amount:
                    finalAmount,

                withdrawalId:
                    withdrawal.withdrawalId,

                remarks:
                    `BIASHNET seller withdrawal ${withdrawal.withdrawalId}`,

                occasion:
                    `Seller payout ${withdrawal.withdrawalId}`,

            });

    } catch (error) {

        console.error(
            "❌ B2C initiation request failed:",
            error
        );

        /*
        Safaricom was not successfully contacted.

        Return the seller's locked money to available.
        */

        await failWithdrawal({

            withdrawalId:
                withdrawal.withdrawalId,

            reason:
                error.message ||
                "Unable to initiate M-Pesa B2C payout.",

            providerResponse:
                error.response?.data ||
                null,

        });

        throw error;

    }


    /*
    =====================================================
    7. SAVE PROVIDER REQUEST
    =====================================================
    */

    await saveB2CRequest({

        withdrawalId:
            withdrawal.withdrawalId,

        provider:
            PAYMENT_PROVIDERS.MPESA,

        request:
            providerResponse,

    });


    /*
    =====================================================
    8. CHECK SAFARICOM ACCEPTANCE
    =====================================================

    Important distinction:

    ResponseCode 0 means Safaricom accepted the B2C
    request for processing.

    It does NOT yet mean the seller has received money.

    Actual completion comes from B2C callback.
    */

    const responseCode =
        Number(
            providerResponse?.ResponseCode ??
            providerResponse?.responseCode
        );


    if (
        !Number.isFinite(
            responseCode
        ) ||
        responseCode !== 0
    ) {

        const reason =
            providerResponse?.ResponseDescription ||
            providerResponse?.responseDescription ||
            "Safaricom rejected the B2C request.";

        await failWithdrawal({

            withdrawalId:
                withdrawal.withdrawalId,

            reason,

            providerResponse,

        });

        throw new Error(
            reason
        );

    }


    /*
    =====================================================
    9. MOVE WITHDRAWAL → PROCESSING
    =====================================================
    */

    const processingResult =
        await markWithdrawalProcessing({

            withdrawalId:
                withdrawal.withdrawalId,

            conversationId:
                providerResponse?.ConversationID ||
                providerResponse?.conversationId ||
                null,

            originatorConversationId:
                providerResponse?.OriginatorConversationID ||
                providerResponse?.originatorConversationId ||
                null,

        });


    /*
    =====================================================
    10. RETURN
    =====================================================
    */

    console.log(
        "=========================================="
    );

    console.log(
        "💸 BIASHNET B2C REQUEST ACCEPTED"
    );

    console.log({

        withdrawalId:
            withdrawal.withdrawalId,

        sellerId:
            userId,

        amount:
            finalAmount,

        phone:
            finalPhone,

        status:
            PAYOUT_STATUS.PROCESSING,

        conversationId:
            providerResponse?.ConversationID ||
            null,

    });

    console.log(
        "=========================================="
    );


    return {

        success: true,

        withdrawalId:
            withdrawal.withdrawalId,

        sellerId:
            userId,

        amount:
            finalAmount,

        phone:
            finalPhone,

        status:
            PAYOUT_STATUS.PROCESSING,

        conversationId:
            providerResponse?.ConversationID ||
            providerResponse?.conversationId ||
            null,

        originatorConversationId:
            providerResponse?.OriginatorConversationID ||
            providerResponse?.originatorConversationId ||
            null,

        message:
            "M-Pesa payout request accepted. Waiting for Safaricom confirmation.",

        processing:
            processingResult,

    };

}


/*
=========================================================
RETRY EXISTING WITHDRAWAL
=========================================================

Useful when a withdrawal already exists as PENDING.

DO NOT create another withdrawal or lock the money
twice.
=========================================================
*/

async function retryB2CWithdrawal(
    withdrawalId
) {

    const withdrawal =
        await getWithdrawal(
            withdrawalId
        );

    if (!withdrawal) {

        throw new Error(
            "Withdrawal not found."
        );

    }

    if (
        withdrawal.status ===
        PAYOUT_STATUS.COMPLETED
    ) {

        return {

            success: true,

            alreadyCompleted: true,

            withdrawalId,

            status:
                PAYOUT_STATUS.COMPLETED,

        };

    }

    if (
        withdrawal.status ===
        PAYOUT_STATUS.PROCESSING
    ) {

        return {

            success: true,

            alreadyProcessing: true,

            withdrawalId,

            status:
                PAYOUT_STATUS.PROCESSING,

        };

    }

    if (
        withdrawal.status ===
        PAYOUT_STATUS.FAILED
    ) {

        throw new Error(
            "Failed withdrawals should not be retried automatically. Create a new withdrawal request."
        );

    }

    return initiateB2CWithdrawal({

        userId:
            withdrawal.userId,

        amount:
            withdrawal.amount,

        phoneNumber:
            withdrawal.phone,

        withdrawalId,

    });

}


module.exports = {

    initiateB2CWithdrawal,

    retryB2CWithdrawal,

    getWithdrawal,

    normalizePhone,

    validatePhone,

    toMoney,

};