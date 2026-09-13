/*
=========================================================
WHICH ACCOUNT A NOTIFICATION BELONGS TO
=========================================================

One person can hold several Biashnet accounts on a single
login — buyer, seller, work, investor, admin — and every
notification is stored against the same uid. The audience
says which of those accounts it concerns, so that:

  - each account's notification screen shows only its own
  - tapping a push opens the right account (switching
    buyer <-> seller in place, or sending the user to sign
    in for a protected account first)

Audience values match the frontend's account types, just
upper-cased: BUYER, SELLER, EMPLOYEE (work), INVESTOR,
ADMIN.

Most notification types imply their audience. The one
that does not is ORDER_OUT_FOR_DELIVERY, which is sent to
both the buyer and every seller on the order — callers
MUST pass the audience for it explicitly.
=========================================================
*/

const AUDIENCES = {

    BUYER: "BUYER",

    SELLER: "SELLER",

    EMPLOYEE: "EMPLOYEE",

    INVESTOR: "INVESTOR",

    ADMIN: "ADMIN",

};


const TYPE_AUDIENCE = {

    /* buyer */
    MARKETPLACE_ORDER_PLACED: AUDIENCES.BUYER,
    MARKETPLACE_PAYMENT_SUCCESS: AUDIENCES.BUYER,
    PAYMENT_SUCCESS: AUDIENCES.BUYER,
    ORDER_COMPLETION_CODE: AUDIENCES.BUYER,
    SELLER_DROPOFF_RECEIVED: AUDIENCES.BUYER,
    ORDER_COMPLETED: AUDIENCES.BUYER,
    ORDER_CANCELLED_REFUNDED: AUDIENCES.BUYER,
    PARTIAL_FULFILLMENT_CHOICE: AUDIENCES.BUYER,

    /* seller */
    NEW_MARKETPLACE_ORDER: AUDIENCES.SELLER,
    NEW_ORDER: AUDIENCES.SELLER,
    DROPOFF_CONFIRMED: AUDIENCES.SELLER,
    DROPOFF_NON_COMPLIANT: AUDIENCES.SELLER,
    FUNDS_RELEASED: AUDIENCES.SELLER,
    ORDER_CANCELLED: AUDIENCES.SELLER,

    /* work account */
    EXPENSE_POSTED: AUDIENCES.EMPLOYEE,
    STIPEND_PAID: AUDIENCES.EMPLOYEE,
    REPORT_REVIEWED: AUDIENCES.EMPLOYEE,
    ROLE_CHANGE_REQUESTED: AUDIENCES.EMPLOYEE,
    ROLE_CHANGE_APPROVED: AUDIENCES.EMPLOYEE,

    /* investor */
    INVESTOR_PAYOUT: AUDIENCES.INVESTOR,

};


function normalize(value) {

    const audience =
        String(value || "")
            .trim()
            .toUpperCase();

    return AUDIENCES[audience] || null;

}


/*
Explicit audience wins; otherwise infer from the type.
Returns null when neither says — such a notification is
treated as belonging to every account rather than hidden.
*/

function resolveAudience({ audience, type } = {}) {

    return (
        normalize(audience) ||
        TYPE_AUDIENCE[String(type || "").toUpperCase()] ||
        null
    );

}


/*
Audience of a stored notification document. Older
documents may carry it under data.audience, or not at all.
*/

function audienceOf(notification) {

    return resolveAudience({

        audience:
            notification?.audience ||
            notification?.data?.audience,

        type:
            notification?.type,

    });

}


module.exports = {

    AUDIENCES,

    normalizeAudience: normalize,

    resolveAudience,

    audienceOf,

};
