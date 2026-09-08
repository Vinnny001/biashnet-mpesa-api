/*
=========================================================
SEED FINANCE DOMAIN
=========================================================

One-off script. Run manually:

    node scripts/seedFinance.js

Creates:

- companyInfos/main
- financeWalletAccounts/company (zeroed treasury wallet)
- 5 positions (CEO, Tech Lead, HR, Accountant, Marketing Lead)
- 5 employees, linking the real UIDs pasted by the user to
  their positions/roles

IMPORTANT:

This ONLY writes to companyInfos, financeWalletAccounts,
positions, and employees — all new collections. It never
writes to users/{uid} or any other existing collection.

Stipend amounts below are PLACEHOLDERS — edit them in the
`positions` collection (or via PATCH /api/positions/:id)
after seeding.
=========================================================
*/

require("dotenv").config();

const { db, FieldValue } = require("../config/firebase");

const { FINANCE_COLLECTIONS, COMPANY_WALLET_ID } = require("../config/financeCollections");

const { EMPLOYMENT_STATUS } = require("../config/financeConstants");


const POSITIONS = [

    { key: "ceo", name: "Chief Executive Officer", stipend: 0, payoutInterval: "monthly", description: "CEO" },

    { key: "techlead", name: "Tech Lead", stipend: 0, payoutInterval: "monthly", description: "Technical lead" },

    { key: "hr", name: "HR", stipend: 0, payoutInterval: "monthly", description: "Human resources" },

    { key: "accountant", name: "Accountant", stipend: 0, payoutInterval: "monthly", description: "Accountant" },

    { key: "marketing", name: "Marketing Lead", stipend: 0, payoutInterval: "monthly", description: "Marketing lead" },

];


const EMPLOYEES = [

    {
        uid: "OP45fCYvsxeF9ugFH02tkdLihKB2",
        positionKey: "techlead",
        roles: { techlead: true, admin: true },
    },
    {
        uid: "RQo6QeBt6eQ8IKjGVwPZQXkkGJq2",
        positionKey: "ceo",
        roles: { ceo: true, admin: true },
    },
    {
        uid: "gu8DdtNMR0fl0h3V8HN0DbBZlN03",
        positionKey: "accountant",
        roles: { accountant: true },
    },
    {
        uid: "TrDV9KYcFbdHMT8lpE92Ews98MQ2",
        positionKey: "hr",
        roles: { hr: true },
    },
    {
        uid: "GbCM87VDsAVB6duH2IARMYETVQv2",
        positionKey: "marketing",
        roles: { marketing: true },
    },

];


async function seed() {

    console.log("🌱 Seeding finance domain...");

    /*
    -------------------------------------------------------
    companyInfos/main
    -------------------------------------------------------
    */

    await db
        .collection(FINANCE_COLLECTIONS.COMPANY_INFOS)
        .doc("main")
        .set(
            {
                name: "BIASHNET LTD",
                sharePrice: 100,
                branch: "main",
                description: "",
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

    console.log("✅ companyInfos/main seeded.");

    /*
    -------------------------------------------------------
    financeWalletAccounts/company
    -------------------------------------------------------
    */

    const companyWalletRef = db
        .collection(FINANCE_COLLECTIONS.FINANCE_WALLET_ACCOUNTS)
        .doc(COMPANY_WALLET_ID);

    const companyWalletSnap = await companyWalletRef.get();

    if (!companyWalletSnap.exists) {

        await companyWalletRef.set({

            ownerId: COMPANY_WALLET_ID,

            ownerType: "platform",

            currency: "KES",

            availableBalance: 0,

            totalContributions: 0,

            contributionBalance: 0,

            withdrawalBalance: 0,

            totalWithdrawn: 0,

            createdAt: FieldValue.serverTimestamp(),

            updatedAt: FieldValue.serverTimestamp(),

        });

        console.log("✅ financeWalletAccounts/company seeded.");

    } else {

        console.log("↩️  financeWalletAccounts/company already exists, skipped.");

    }

    /*
    -------------------------------------------------------
    positions
    -------------------------------------------------------
    */

    const positionIds = {};

    for (const position of POSITIONS) {

        const existing = await db
            .collection(FINANCE_COLLECTIONS.POSITIONS)
            .where("name", "==", position.name)
            .limit(1)
            .get();

        if (!existing.empty) {

            positionIds[position.key] = existing.docs[0].id;

            console.log(`↩️  Position "${position.name}" already exists, skipped.`);

            continue;

        }

        const positionRef = db.collection(FINANCE_COLLECTIONS.POSITIONS).doc();

        await positionRef.set({

            positionId: positionRef.id,

            name: position.name,

            stipend: position.stipend,

            payoutInterval: position.payoutInterval,

            description: position.description,

            createdBy: "seed_script",

            createdAt: FieldValue.serverTimestamp(),

            updatedAt: FieldValue.serverTimestamp(),

        });

        positionIds[position.key] = positionRef.id;

        console.log(`✅ Position "${position.name}" seeded (${positionRef.id}).`);

    }

    /*
    -------------------------------------------------------
    employees
    -------------------------------------------------------
    */

    for (const employee of EMPLOYEES) {

        const employeeRef = db.collection(FINANCE_COLLECTIONS.EMPLOYEES).doc(employee.uid);

        const existing = await employeeRef.get();

        if (existing.exists) {

            console.log(`↩️  Employee ${employee.uid} already exists, skipped.`);

            continue;

        }

        await employeeRef.set({

            employeeId: employee.uid,

            userId: employee.uid,

            positionId: positionIds[employee.positionKey],

            roles: {
                ceo: false,
                hr: false,
                accountant: false,
                techlead: false,
                marketing: false,
                admin: false,
                ...employee.roles,
            },

            employmentStatus: EMPLOYMENT_STATUS.ACTIVE,

            addedBy: "seed_script",

            createdAt: FieldValue.serverTimestamp(),

            updatedAt: FieldValue.serverTimestamp(),

        });

        await db
            .collection(FINANCE_COLLECTIONS.FINANCE_WALLET_ACCOUNTS)
            .doc(employee.uid)
            .set(
                {
                    ownerId: employee.uid,
                    ownerType: "employee",
                    currency: "KES",
                    availableBalance: 0,
                    totalContributions: 0,
                    contributionBalance: 0,
                    withdrawalBalance: 0,
                    totalWithdrawn: 0,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );

        console.log(`✅ Employee ${employee.uid} seeded.`);

    }

    console.log("🌱 Finance domain seed complete.");

}


seed()
    .then(() => process.exit(0))
    .catch((error) => {

        console.error("❌ Seed failed:", error);

        process.exit(1);

    });
