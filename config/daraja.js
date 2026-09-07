require("dotenv").config();


/*
=========================================================
BIASHNET M-PESA DARaja CONFIGURATION
=========================================================

Supports:

1. STK PUSH
   Buyer → BIASHNET

2. B2C
   BIASHNET → Seller

=========================================================
*/

const DARajaConfig = {

    /*
    =====================================================
    COMMON AUTHENTICATION
    =====================================================
    */

    consumerKey:
        process.env.MPESA_CONSUMER_KEY,

    consumerSecret:
        process.env.MPESA_CONSUMER_SECRET,


    /*
    =====================================================
    C2B / STK BUSINESS SHORTCODE
    =====================================================
    */

    shortCode:
        process.env.MPESA_SHORTCODE,

    passKey:
        process.env.MPESA_PASSKEY,


    /*
    =====================================================
    STK CALLBACK
    =====================================================
    */

    callbackUrl:
        process.env.CALLBACK_URL,


    /*
    =====================================================
    SAFARICOM OAUTH
    =====================================================
    */

    oauthUrl:
        process.env.MPESA_OAUTH_URL ||
        "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",


    /*
    =====================================================
    STK PUSH URL
    =====================================================
    */

    stkPushUrl:
        process.env.MPESA_STK_PUSH_URL ||
        "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",


    /*
    =====================================================
    B2C CONFIGURATION
    =====================================================

    BIASHNET
        ↓
    Safaricom
        ↓
    Seller M-PESA

    =====================================================
    */

    b2cUrl:
        process.env.MPESA_B2C_URL ||
        "https://api.safaricom.co.ke/mpesa/b2cpayments/v1/paymentrequest",


    /*
    B2C shortcode.

    Usually the same business shortcode used by
    your M-Pesa account, but kept separate so it
    can be changed independently later.
    */

    b2cShortCode:
        process.env.MPESA_B2C_SHORTCODE ||
        process.env.MPESA_SHORTCODE,


    /*
    =====================================================
    B2C INITIATOR
    =====================================================

    This must be the initiator configured in your
    Safaricom Daraja B2C setup.
    */

    initiatorName:
        process.env.MPESA_B2C_INITIATOR_NAME,


    /*
    =====================================================
    B2C SECURITY CREDENTIAL
    =====================================================

    This is the encrypted credential issued for
    your B2C integration.

    DO NOT expose this to frontend/mobile code.
    */

    securityCredential:
        process.env.MPESA_B2C_SECURITY_CREDENTIAL,


    /*
    =====================================================
    B2C TIMEOUT CALLBACK
    =====================================================
    */

    b2cTimeoutUrl:
        process.env.MPESA_B2C_TIMEOUT_URL ||
        `${process.env.BACKEND_BASE_URL}/api/webhooks/mpesa/b2c/timeout`,


    /*
    =====================================================
    B2C RESULT CALLBACK
    =====================================================
    */

    b2cResultUrl:
        process.env.MPESA_B2C_RESULT_URL ||
        `${process.env.BACKEND_BASE_URL}/api/webhooks/mpesa/b2c`,


    /*
    Alias supported by darajaService
    */

    b2cCallbackUrl:
        process.env.MPESA_B2C_CALLBACK_URL ||
        process.env.MPESA_B2C_RESULT_URL ||
        `${process.env.BACKEND_BASE_URL}/api/webhooks/mpesa/b2c`,

};


/*
=========================================================
VALIDATE DARaja CONFIGURATION
=========================================================
*/

function validateDarajaConfig() {

    const required = {

        MPESA_CONSUMER_KEY:
            DARajaConfig.consumerKey,

        MPESA_CONSUMER_SECRET:
            DARajaConfig.consumerSecret,

        MPESA_SHORTCODE:
            DARajaConfig.shortCode,

        MPESA_PASSKEY:
            DARajaConfig.passKey,

        CALLBACK_URL:
            DARajaConfig.callbackUrl,

    };


    const missing =
        Object.entries(
            required
        )
            .filter(
                ([, value]) =>
                    !value
            )
            .map(
                ([key]) =>
                    key
            );


    if (
        missing.length > 0
    ) {

        throw new Error(
            `Missing M-PESA configuration: ${missing.join(", ")}`
        );

    }

}


/*
=========================================================
VALIDATE B2C CONFIGURATION
=========================================================

Do NOT include this in validateDarajaConfig()
because STK-only environments should still be able
to start.

The B2C service will call this when a withdrawal is
actually being initiated.

=========================================================
*/

function validateB2CConfig() {

    const required = {

        MPESA_B2C_URL:
            DARajaConfig.b2cUrl,

        MPESA_B2C_SHORTCODE:
            DARajaConfig.b2cShortCode,

        MPESA_B2C_INITIATOR_NAME:
            DARajaConfig.initiatorName,

        MPESA_B2C_SECURITY_CREDENTIAL:
            DARajaConfig.securityCredential,

        MPESA_B2C_TIMEOUT_URL:
            DARajaConfig.b2cTimeoutUrl,

        MPESA_B2C_RESULT_URL:
            DARajaConfig.b2cResultUrl,

    };


    const missing =
        Object.entries(
            required
        )
            .filter(
                ([, value]) =>
                    !value
            )
            .map(
                ([key]) =>
                    key
            );


    if (
        missing.length > 0
    ) {

        throw new Error(
            `Missing M-PESA B2C configuration: ${missing.join(", ")}`
        );

    }


    return true;

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    DARajaConfig,

    validateDarajaConfig,

    validateB2CConfig,

};