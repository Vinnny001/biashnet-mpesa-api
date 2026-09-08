const {
    db,
    FieldValue,
} = require("../config/firebase");

const { FINANCE_COLLECTIONS } = require("../config/financeCollections");


/*
=========================================================
COMPANY INFO SERVICE
=========================================================

companyInfos/main — single document.
=========================================================
*/

const COMPANY_INFO_DOC_ID = "main";


async function getCompanyInfo() {

    const snap = await db
        .collection(FINANCE_COLLECTIONS.COMPANY_INFOS)
        .doc(COMPANY_INFO_DOC_ID)
        .get();

    if (!snap.exists) {

        return null;

    }

    return { id: snap.id, ...snap.data() };

}


async function updateCompanyInfo(updates = {}) {

    const allowed = {};

    ["name", "sharePrice", "branch", "description"].forEach((key) => {

        if (updates[key] !== undefined) allowed[key] = updates[key];

    });

    allowed.updatedAt = FieldValue.serverTimestamp();

    const ref = db.collection(FINANCE_COLLECTIONS.COMPANY_INFOS).doc(COMPANY_INFO_DOC_ID);

    await ref.set(allowed, { merge: true });

    const snap = await ref.get();

    return { id: snap.id, ...snap.data() };

}


module.exports = { getCompanyInfo, updateCompanyInfo, COMPANY_INFO_DOC_ID };
