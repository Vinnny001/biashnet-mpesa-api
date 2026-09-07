const { db } = require("../config/firebase");


/*
=========================================================
BIASHNET COMMISSION SERVICE
=========================================================

PURPOSE
---------------------------------------------------------

Determines BIASHNET marketplace commission.

DESIGN PRINCIPLE
---------------------------------------------------------

BIASHNET intentionally keeps seller commissions LOW.

The objective is:

- attract sellers
- increase product supply
- encourage repeat selling
- make BIASHNET more attractive than high-fee marketplaces
- keep pricing transparent

IMPORTANT

This service calculates commission only.

It does NOT:

- credit seller wallets
- credit company wallet
- create transactions
- process payments
- process withdrawals

Those responsibilities belong to:

paymentService
settlementService
transactionService
wallet services

=========================================================
LAUNCH COMMISSION MODEL
=========================================================

PRODUCT CATEGORIES

Phones        5%
Electronics   5%
Laptops       5%
Food          5%
Books         5%
Vehicles      5%

Fashion       6%
Shoes         6%
Beauty        6%
Accessories   6%
General       6%

Services      8%
Housing       8%

=========================================================
IMPORTANT
=========================================================

The rate used during checkout becomes part of the
server-side financial snapshot.

Therefore changing the commission settings later does
NOT change historical orders.

=========================================================
*/


/*
=========================================================
DEFAULT
=========================================================
*/

const DEFAULT_COMMISSION_RATE = 0.06;


/*
=========================================================
MAXIMUM COMMISSION SAFETY
=========================================================

BIASHNET should never accidentally charge an extreme
percentage because of a bad Firestore configuration.

The marketplace commission configuration must therefore
stay within this upper limit.

=========================================================
*/

const MAX_COMMISSION_RATE = 0.10;


/*
=========================================================
LAUNCH CATEGORY RATES
=========================================================
*/

const COMMISSION_RATES = {

    phones:
        0.04,

    electronics:
        0.04,

    laptops:
        0.04,

    food:
        0.03,

    books:
        0.05,

    vehicles:
        0.05,

    fashion:
        0.06,

    shoes:
        0.05,

    beauty:
        0.04,

    accessories:
        0.04,

    general:
        0.04,

    services:
        0.08,

    housing:
        0.08,

};


/*
=========================================================
CATEGORY ALIASES
=========================================================

Handles variations from existing product data.

Example:

"Fashion"
"fashion"
"fashion products"

=========================================================
*/

const CATEGORY_ALIASES = {

    phone:
        "phones",

    mobile:
        "phones",

    mobile_phone:
        "phones",

    mobile_phones:
        "phones",

    smartphones:
        "phones",

    smartphone:
        "phones",

    electronics:
        "electronics",

    electronic:
        "electronics",

    laptop:
        "laptops",

    computers:
        "laptops",

    computer:
        "laptops",

    clothes:
        "fashion",

    clothing:
        "fashion",

    fashion_products:
        "fashion",

    shoes:
        "shoes",

    footwear:
        "shoes",

    beauty:
        "beauty",

    cosmetics:
        "beauty",

    accessory:
        "accessories",

    accessories:
        "accessories",

    food:
        "food",

    groceries:
        "food",

    book:
        "books",

    books:
        "books",

    car:
        "vehicles",

    cars:
        "vehicles",

    vehicle:
        "vehicles",

    services:
        "services",

    service:
        "services",

    housing:
        "housing",

    house:
        "housing",

    houses:
        "housing",

};


/*
=========================================================
NORMALIZE CATEGORY
=========================================================
*/

function normalizeCategory(category) {

    if (
        category === undefined ||
        category === null
    ) {

        return "general";

    }


    const raw =
        String(category)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");


    if (!raw) {

        return "general";

    }


    return (
        CATEGORY_ALIASES[raw] ||
        raw
    );

}


/*
=========================================================
VALIDATE RATE
=========================================================
*/

function isValidRate(
    value
) {

    const rate =
        Number(value);


    return (
        Number.isFinite(rate) &&
        rate >= 0 &&
        rate <= MAX_COMMISSION_RATE
    );

}


/*
=========================================================
FIRESTORE COMMISSION SETTINGS
=========================================================

Document:

marketplaceSettings/commissions

Example:

{
    phones: 0.05,
    electronics: 0.05,
    fashion: 0.06,
    services: 0.08
}

=========================================================
*/

async function getConfiguredCommissionRate(
    category
) {

    try {

        const ref =
            db
                .collection(
                    "marketplaceSettings"
                )
                .doc(
                    "commissions"
                );


        const snapshot =
            await ref.get();


        if (
            !snapshot.exists
        ) {

            return null;

        }


        const settings =
            snapshot.data() || {};


        const configuredRate =
            settings[category];


        if (
            configuredRate === undefined
        ) {

            return null;

        }


        if (
            !isValidRate(
                configuredRate
            )
        ) {

            console.error(

                `Invalid BIASHNET commission rate for category ${category}:`,

                configuredRate

            );

            return null;

        }


        return Number(
            configuredRate
        );

    } catch (error) {

        console.error(
            "Commission settings lookup failed:",
            error
        );

        return null;

    }

}


/*
=========================================================
GET COMMISSION RATE
=========================================================
*/

async function getCommissionRate(
    category
) {

    const normalizedCategory =
        normalizeCategory(
            category
        );


    /*
    -----------------------------------------------------
    FIRESTORE OVERRIDE
    -----------------------------------------------------
    */

    const configuredRate =
        await getConfiguredCommissionRate(
            normalizedCategory
        );


    if (
        configuredRate !== null
    ) {

        return configuredRate;

    }


    /*
    -----------------------------------------------------
    CODE DEFAULT
    -----------------------------------------------------
    */

    const categoryRate =
        COMMISSION_RATES[
            normalizedCategory
        ];


    if (
        isValidRate(
            categoryRate
        )
    ) {

        return categoryRate;

    }


    return DEFAULT_COMMISSION_RATE;

}


/*
=========================================================
CALCULATE COMMISSION
=========================================================
*/

async function calculateCommission({

    amount,

    category,

}) {

    const saleAmount =
        Number(amount);


    /*
    -----------------------------------------------------
    SALE VALIDATION
    -----------------------------------------------------
    */

    if (
        !Number.isFinite(
            saleAmount
        ) ||
        saleAmount <= 0
    ) {

        throw new Error(
            "Invalid sale amount."
        );

    }


    /*
    -----------------------------------------------------
    CATEGORY
    -----------------------------------------------------
    */

    const normalizedCategory =
        normalizeCategory(
            category
        );


    /*
    -----------------------------------------------------
    RATE
    -----------------------------------------------------
    */

    const commissionRate =
        await getCommissionRate(
            normalizedCategory
        );


    /*
    -----------------------------------------------------
    COMMISSION
    -----------------------------------------------------
    */

    const commissionAmount =
        Number(
            (
                saleAmount *
                commissionRate
            ).toFixed(2)
        );


    /*
    -----------------------------------------------------
    SELLER NET
    -----------------------------------------------------
    */

    const sellerNet =
        Number(
            (
                saleAmount -
                commissionAmount
            ).toFixed(2)
        );


    /*
    -----------------------------------------------------
    FINANCIAL SAFETY
    -----------------------------------------------------
    */

    if (
        commissionAmount < 0
    ) {

        throw new Error(
            "Commission cannot be negative."
        );

    }


    if (
        commissionAmount >
        saleAmount
    ) {

        throw new Error(
            "Commission cannot exceed sale amount."
        );

    }


    if (
        sellerNet < 0
    ) {

        throw new Error(
            "Seller net cannot be negative."
        );

    }


    /*
    -----------------------------------------------------
    BALANCE CHECK
    -----------------------------------------------------
    */

    const calculatedTotal =
        Number(
            (
                commissionAmount +
                sellerNet
            ).toFixed(2)
        );


    if (
        Math.abs(
            calculatedTotal -
            saleAmount
        ) > 0.01
    ) {

        throw new Error(
            "Commission calculation does not balance."
        );

    }


    /*
    -----------------------------------------------------
    RESULT
    -----------------------------------------------------
    */

    return {

        category:
            normalizedCategory,

        commissionRate,

        commissionPercentage:
            Number(
                (
                    commissionRate *
                    100
                ).toFixed(2)
            ),

        commissionAmount,

        sellerGross:
            saleAmount,

        sellerNet,

        saleAmount,

    };

}


/*
=========================================================
CALCULATE MULTI-ITEM COMMISSION
=========================================================

Useful when a seller has several items in the same order.

Each item can still have its own category/rate.

=========================================================
*/

async function calculateOrderCommission(
    items = []
) {

    if (
        !Array.isArray(items) ||
        !items.length
    ) {

        throw new Error(
            "Order items are required."
        );

    }


    let grossAmount = 0;
    let commissionAmount = 0;
    let sellerNet = 0;


    const breakdown = [];


    for (
        const item of items
    ) {

        const itemTotal =
            Number(
                item.itemTotal ||
                0
            );


        if (
            !Number.isFinite(
                itemTotal
            ) ||
            itemTotal <= 0
        ) {

            throw new Error(
                `Invalid item amount for ${item.listingId || "product"}.`
            );

        }


        const commission =
            await calculateCommission({

                amount:
                    itemTotal,

                category:
                    item.category ||
                    "general",

            });


        grossAmount +=
            commission.sellerGross;


        commissionAmount +=
            commission.commissionAmount;


        sellerNet +=
            commission.sellerNet;


        breakdown.push({

            listingId:
                item.listingId ||
                null,

            category:
                commission.category,

            grossAmount:
                commission.sellerGross,

            commissionRate:
                commission.commissionRate,

            commissionAmount:
                commission.commissionAmount,

            sellerNet:
                commission.sellerNet,

        });

    }


    grossAmount =
        Number(
            grossAmount.toFixed(2)
        );


    commissionAmount =
        Number(
            commissionAmount.toFixed(2)
        );


    sellerNet =
        Number(
            sellerNet.toFixed(2)
        );


    return {

        grossAmount,

        commissionAmount,

        sellerNet,

        breakdown,

    };

}


/*
=========================================================
GET COMMISSION CONFIG
=========================================================

Useful for admin dashboards/settings.

=========================================================
*/

function getDefaultCommissionTable() {

    return {

        ...COMMISSION_RATES,

        general:
            DEFAULT_COMMISSION_RATE,

    };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    getCommissionRate,

    calculateCommission,

    calculateOrderCommission,

    normalizeCategory,

    getDefaultCommissionTable,

};