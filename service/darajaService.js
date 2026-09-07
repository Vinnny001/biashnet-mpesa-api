const axios =
    require("axios");

const {
    DARajaConfig,
    validateDarajaConfig,
} =
    require("../config/daraja");


let cachedToken = null;
let tokenExpiresAt = 0;


/*
=========================================================
GET ACCESS TOKEN
=========================================================
*/

async function getAccessToken() {

    validateDarajaConfig();

    const now =
        Date.now();


    if (
        cachedToken &&
        now < tokenExpiresAt
    ) {

        return cachedToken;

    }


    const auth =
        Buffer.from(
            `${DARajaConfig.consumerKey}:` +
            `${DARajaConfig.consumerSecret}`
        ).toString("base64");


    try {

        const response =
            await axios.get(
                DARajaConfig.oauthUrl,
                {
                    headers: {

                        Authorization:
                            `Basic ${auth}`,

                    },

                    timeout:
                        15000,

                }
            );


        const token =
            response.data?.access_token;


        if (!token) {

            throw new Error(
                "M-PESA access token was not returned."
            );

        }


        cachedToken =
            token;


        const expiresIn =
            Number(
                response.data?.expires_in ||
                3599
            );


        tokenExpiresAt =
            now +
            Math.max(
                60,
                expiresIn - 60
            ) * 1000;


        return cachedToken;

    } catch (error) {

        console.error(
            "❌ M-PESA OAuth error:",
            error.response?.data ||
            error.message
        );


        throw new Error(
            error.response?.data?.errorMessage ||
            "Unable to obtain M-PESA access token."
        );

    }

}


/*
=========================================================
NORMALIZE PHONE
=========================================================

Supports:

07XXXXXXXX
01XXXXXXXX

7XXXXXXXX
1XXXXXXXX

2547XXXXXXXX
2541XXXXXXXX

+2547XXXXXXXX
+2541XXXXXXXX
=========================================================
*/

function normalizePhone(phone) {

    let value =
        String(phone || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "");


    /*
    +254...
    */

    if (
        value.startsWith("+254")
    ) {

        value =
            value.substring(1);

    }


    /*
    Local:

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
    9 digit:

    7XXXXXXXX
    1XXXXXXXX
    */

    if (
        /^[71]\d{8}$/.test(value)
    ) {

        value =
            "254" +
            value;

    }


    /*
    Final validation.

    Kenyan mobile prefixes:

    2547XXXXXXXX
    2541XXXXXXXX
    */

    if (
        !/^254[71]\d{8}$/.test(value)
    ) {

        throw new Error(
            "Invalid Kenyan M-PESA phone number."
        );

    }


    return value;

}


/*
=========================================================
TIMESTAMP
=========================================================
*/

function getTimestamp() {

    const now =
        new Date();


    const yyyy =
        now.getFullYear();


    const MM =
        String(
            now.getMonth() + 1
        ).padStart(
            2,
            "0"
        );


    const dd =
        String(
            now.getDate()
        ).padStart(
            2,
            "0"
        );


    const HH =
        String(
            now.getHours()
        ).padStart(
            2,
            "0"
        );


    const mm =
        String(
            now.getMinutes()
        ).padStart(
            2,
            "0"
        );


    const ss =
        String(
            now.getSeconds()
        ).padStart(
            2,
            "0"
        );


    return (
        `${yyyy}${MM}${dd}` +
        `${HH}${mm}${ss}`
    );

}


/*
=========================================================
STK PUSH
=========================================================
*/

async function stkPush({

    phone,

    amount,

    accountReference,

    transactionDesc,

}) {

    const normalizedPhone =
        normalizePhone(
            phone
        );


    const numericAmount =
        Number(
            amount
        );


    if (
        !Number.isFinite(
            numericAmount
        ) ||
        numericAmount <= 0
    ) {

        throw new Error(
            "Invalid M-PESA payment amount."
        );

    }


    const token =
        await getAccessToken();


    const timestamp =
        getTimestamp();


    const password =
        Buffer.from(
            DARajaConfig.shortCode +
            DARajaConfig.passKey +
            timestamp
        ).toString(
            "base64"
        );


    console.log(
        "📲 Sending STK Push:",
        {
            phone:
                normalizedPhone,

            amount:
                numericAmount,

            accountReference,

        }
    );


    try {

        const response =
            await axios.post(

                DARajaConfig.stkPushUrl,

                {

                    BusinessShortCode:
                        DARajaConfig.shortCode,

                    Password:
                        password,

                    Timestamp:
                        timestamp,

                    TransactionType:
                        "CustomerPayBillOnline",

                    Amount:
                        numericAmount,

                    PartyA:
                        normalizedPhone,

                    PartyB:
                        DARajaConfig.shortCode,

                    PhoneNumber:
                        normalizedPhone,

                    CallBackURL:
                        DARajaConfig.callbackUrl,

                    AccountReference:
                        accountReference,

                    TransactionDesc:
                        transactionDesc ||
                        `BIASHNET ${accountReference}`,

                },

                {

                    headers: {

                        Authorization:
                            `Bearer ${token}`,

                        "Content-Type":
                            "application/json",

                    },

                    timeout:
                        20000,

                }

            );


        return response.data;

    } catch (error) {

        console.error(
            "❌ STK Push error:",
            error.response?.data ||
            error.message
        );


        throw new Error(
            error.response?.data?.errorMessage ||
            error.response?.data?.errorCode ||
            "Failed to send M-PESA STK Push."
        );

    }

}


/*
=========================================================
B2C PAYMENT
=========================================================

BIASHNET
   ↓
Daraja B2C
   ↓
Safaricom
   ↓
Seller M-PESA

IMPORTANT:

A successful HTTP response here means the B2C REQUEST
was accepted by Safaricom.

It does NOT yet mean the seller received the money.

Final success comes from:

/api/webhooks/mpesa/b2c

=========================================================
*/

async function initiateB2CPayment({

    phone,

    amount,

    withdrawalId,

    remarks,

    occasion,

}) {

    /*
    -----------------------------------------------------
    PHONE
    -----------------------------------------------------
    */

    const normalizedPhone =
        normalizePhone(
            phone
        );


    /*
    -----------------------------------------------------
    AMOUNT
    -----------------------------------------------------
    */

    const numericAmount =
        Number(
            amount
        );


    if (
        !Number.isFinite(
            numericAmount
        ) ||
        numericAmount <= 0
    ) {

        throw new Error(
            "Invalid B2C payout amount."
        );

    }


    /*
    -----------------------------------------------------
    WITHDRAWAL ID
    -----------------------------------------------------
    */

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required for B2C payout."
        );

    }


    /*
    -----------------------------------------------------
    REQUIRED DARaja CONFIG
    -----------------------------------------------------
    */

    if (
        !DARajaConfig.b2cUrl
    ) {

        throw new Error(
            "Daraja B2C URL is not configured."
        );

    }


    if (
        !DARajaConfig.b2cShortCode &&
        !DARajaConfig.shortCode
    ) {

        throw new Error(
            "Daraja B2C shortcode is not configured."
        );

    }


    if (
        !DARajaConfig.securityCredential
    ) {

        throw new Error(
            "Daraja B2C security credential is not configured."
        );

    }


    const token =
        await getAccessToken();


    /*
    -----------------------------------------------------
    B2C CALLBACK URL
    -----------------------------------------------------
    */

    const resultUrl =
        DARajaConfig.b2cResultUrl ||
        DARajaConfig.b2cCallbackUrl;


    if (!resultUrl) {

        throw new Error(
            "Daraja B2C result URL is not configured."
        );

    }


    /*
    -----------------------------------------------------
    SAFARICOM B2C PAYLOAD
    -----------------------------------------------------

    CommandID:

    BusinessPayment

    PartyB:

    Seller's M-PESA number

    Amount:

    Seller withdrawal amount
    -----------------------------------------------------
    */

    const payload = {

        InitiatorName:
            DARajaConfig.initiatorName,

        SecurityCredential:
            DARajaConfig.securityCredential,

        CommandID:
            "BusinessPayment",

        Amount:
            numericAmount,

        PartyA:
            DARajaConfig.b2cShortCode ||
            DARajaConfig.shortCode,

        PartyB:
            normalizedPhone,

        Remarks:
            remarks ||
            `BIASHNET withdrawal ${withdrawalId}`,

        QueueTimeOutURL:
            DARajaConfig.b2cTimeoutUrl,

        ResultURL:
            resultUrl,

        Occasion:
            occasion ||
            withdrawalId,

    };


    console.log(
        "💸 Sending B2C payout:",
        {
            withdrawalId,

            phone:
                normalizedPhone,

            amount:
                numericAmount,

            partyA:
                DARajaConfig.b2cShortCode ||
                DARajaConfig.shortCode,

        }
    );


    try {

        const response =
            await axios.post(

                DARajaConfig.b2cUrl,

                payload,

                {

                    headers: {

                        Authorization:
                            `Bearer ${token}`,

                        "Content-Type":
                            "application/json",

                    },

                    timeout:
                        20000,

                }

            );


        console.log(
            "✅ B2C request accepted:",
            response.data
        );


        return response.data;

    } catch (error) {

        console.error(
            "❌ B2C initiation error:",
            error.response?.data ||
            error.message
        );


        const providerError =
            error.response?.data;


        throw new Error(
            providerError?.errorMessage ||
            providerError?.ResponseDescription ||
            providerError?.message ||
            "Failed to initiate M-PESA B2C payout."
        );

    }

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    getAccessToken,

    stkPush,

    initiateB2CPayment,

    normalizePhone,

};