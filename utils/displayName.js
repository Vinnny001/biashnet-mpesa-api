const {
    db,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");


/*
=========================================================
WHO IS THIS PERSON?
=========================================================

Notifications name the other party, so a seller reading
"new order from Achieng" knows which of the day's orders
this is, and a buyer on a multi-seller order knows which
shop just delivered.

User documents are not consistent about where the name
lives — some have `name`, some have it empty with a
`firstName` set, sellers sometimes carry `businessName`,
and the only field always present is `email`. So the
lookup walks a fallback chain and, failing everything,
returns null so callers can drop the name from the
sentence rather than print "undefined" or a raw uid at
someone.
=========================================================
*/


function pick(record, fields) {

    for (const field of fields) {

        const value =
            String(
                record?.[field] || ""
            ).trim();

        if (value) {

            return value;

        }

    }

    return null;

}


function fromEmail(record) {

    const email =
        String(
            record?.email || ""
        ).trim();


    if (!email.includes("@")) {

        return null;

    }


    return email.split("@")[0];

}


/*
=========================================================
NAME vs LABEL — NOT THE SAME THING
=========================================================

Two different jobs, and an email local part is only
acceptable for one of them:

  name   greeting the person themselves. Must be a real
         name or nothing. "Dear Customer vintest1," is
         worse than "Dear Customer," — it tells someone
         Biashnet does not know who they are.

  label  identifying the OTHER party, e.g. telling a
         buyer which shop delivered. Here an email handle
         is an acceptable last resort.

A buyer's name or label is NEVER shown to a seller —
sellers are not told who bought from them.

Both come from a single Firestore read.
=========================================================
*/

async function identify(userId, fields) {

    const record =
        await load(userId);


    if (!record) {

        return {
            name: null,
            label: null,
        };

    }


    const name =
        pick(record, fields);


    return {

        name,

        label:
            name ||
            fromEmail(record),

    };

}


/*
=========================================================
SELLER / SHOP NAME
=========================================================

Prefers the trading name: a buyer recognises the shop
they bought from, not the owner's legal name.
=========================================================
*/

const SELLER_FIELDS = [
    "businessName",
    "shopName",
    "name",
    "displayName",
    "firstName",
];


const BUYER_FIELDS = [
    "name",
    "displayName",
    "firstName",
    "businessName",
];


async function getSellerName(sellerId) {

    return (
        await identify(
            sellerId,
            SELLER_FIELDS
        )
    ).name;

}


/*
Seller identity for use in someone else's notification.
*/

async function getSellerIdentity(sellerId) {

    return identify(
        sellerId,
        SELLER_FIELDS
    );

}


async function getBuyerIdentity(buyerId) {

    return identify(
        buyerId,
        BUYER_FIELDS
    );

}


/*
=========================================================
BUYER / CUSTOMER NAME
=========================================================
*/

async function getBuyerName(buyerId) {

    return (
        await identify(
            buyerId,
            BUYER_FIELDS
        )
    ).name;

}


async function load(userId) {

    if (!userId) {

        return null;

    }


    try {

        const snap =
            await db
                .collection(
                    COLLECTIONS.USERS
                )
                .doc(
                    userId
                )
                .get();


        return snap.exists
            ? snap.data()
            : null;

    } catch (error) {

        /*
        A name is decoration. Never let looking one up stop
        a notification from being delivered.
        */

        console.error(
            "Display name lookup failed:",
            error.message
        );

        return null;

    }

}


module.exports = {

    getSellerName,

    getBuyerName,

    getSellerIdentity,

    getBuyerIdentity,

};
