const crypto = require("crypto");

const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");


/*
=========================================================
PAYMENT REFERENCE — NNNNN/MM/YY
=========================================================

The account number the buyer sees in their M-PESA message,
and the code they give the Biashnet rider on delivery.

  45682/08/26
  └─┬─┘ └┬┘ └┬┘
    │    │   └ last two digits of the year
    │    └──── month
    └───────── 5 random digits

Rules:

  - The whole reference is unique. The same five digits may
    be reused in a different month or year:
    45682/08/26 and 45682/07/26 can both exist.

  - No digit appears more than twice in the five
    (22234 is rejected, 22334 is fine), so a code can't be
    a lazy pattern that's easy to guess or mistype.

  - The first digit is never 0, so the number can't lose a
    leading zero when someone writes or types it.

It replaces the old account number (ORDER-ORD-1789), which
was identical for every order, and it is not the order ID
or a sub-order ID.

Month and year are taken in Africa/Nairobi time. Render
runs in UTC, and near midnight on the last day of a month
the server's month would otherwise differ from the buyer's.

Only the five digits are secret — month and year are
guessable — which is why verification keeps its limit on
wrong attempts.
=========================================================
*/

const REFERENCE_PATTERN =
    /^([1-9]\d{4})\/(0[1-9]|1[0-2])\/(\d{2})$/;

const MAX_DIGIT_REPEATS = 2;

const MAX_RESERVATION_ATTEMPTS = 25;


function hasAllowedRepeats(digits) {

    const counts = {};

    for (const digit of String(digits)) {

        counts[digit] = (counts[digit] || 0) + 1;

        if (counts[digit] > MAX_DIGIT_REPEATS) {
            return false;
        }

    }

    return true;

}


function isValidFiveDigits(digits) {

    return (
        /^[1-9]\d{4}$/.test(String(digits)) &&
        hasAllowedRepeats(digits)
    );

}


function randomFiveDigits() {

    // Rejection sampling keeps every allowed value equally likely.
    for (;;) {

        const candidate =
            String(crypto.randomInt(10000, 100000));

        if (isValidFiveDigits(candidate)) {
            return candidate;
        }

    }

}


function nairobiPeriod(date = new Date()) {

    const parts =
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Africa/Nairobi",
            month: "2-digit",
            year: "2-digit",
        }).formatToParts(date);

    return {

        month:
            parts.find((part) => part.type === "month").value,

        year:
            parts.find((part) => part.type === "year").value,

    };

}


function formatReference(digits, month, year) {

    return `${digits}/${month}/${year}`;

}


/*
Firestore document IDs can't contain "/", so the stored ID
uses "-" instead: 45682/08/26 -> 45682-08-26.
*/

function referenceDocId(reference) {

    return String(reference).replace(/\//g, "-");

}


/*
Accepts what a person might reasonably type — spaces, or
"-" / "." instead of "/" — and returns the canonical
45682/08/26, or null if it isn't a reference at all.
*/

function normalizeReference(input) {

    const cleaned =
        String(input || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/[-.\\]/g, "/");

    const match =
        cleaned.match(REFERENCE_PATTERN);

    if (!match || !hasAllowedRepeats(match[1])) {
        return null;
    }

    return cleaned;

}


/*
=========================================================
RESERVE A UNIQUE REFERENCE
=========================================================

create() fails if the document already exists, so writing
the reference's own document IS the uniqueness check —
atomic, and safe when two orders are paying at the same
moment. A collision just draws again.
=========================================================
*/

async function reservePaymentReference({ orderId, paymentId, now = new Date() }) {

    if (!orderId) {

        throw new Error(
            "Order ID is required to issue a payment reference."
        );

    }

    const { month, year } =
        nairobiPeriod(now);

    for (
        let attempt = 1;
        attempt <= MAX_RESERVATION_ATTEMPTS;
        attempt += 1
    ) {

        const reference =
            formatReference(randomFiveDigits(), month, year);

        try {

            await db
                .collection(COLLECTIONS.PAYMENT_REFERENCES)
                .doc(referenceDocId(reference))
                .create({
                    reference,
                    orderId,
                    paymentId: paymentId || null,
                    month,
                    year,
                    createdAt: FieldValue.serverTimestamp(),
                });

            return reference;

        } catch (error) {

            const alreadyTaken =
                error?.code === 6 ||
                /ALREADY_EXISTS/i.test(String(error?.message));

            if (!alreadyTaken) {
                throw error;
            }

        }

    }

    throw new Error(
        "Could not issue a unique payment reference. Please try again."
    );

}


module.exports = {

    reservePaymentReference,

    normalizeReference,

    isValidFiveDigits,

    randomFiveDigits,

    formatReference,

    referenceDocId,

    nairobiPeriod,

    REFERENCE_PATTERN,

};
