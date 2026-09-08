const {
    db,
    FieldValue,
} = require("../config/firebase");

const { FINANCE_COLLECTIONS } = require("../config/financeCollections");


/*
=========================================================
POSITION SERVICE
=========================================================

CRUD for job positions (positions/{positionId}).

{
  positionId, name, stipend, payoutInterval, description,
  createdAt, updatedAt
}
=========================================================
*/

const VALID_PAYOUT_INTERVALS = ["monthly", "quarterly", "yearly"];


async function createPosition({ name, stipend, payoutInterval, description, createdBy }) {

    if (!name || !String(name).trim()) {

        throw new Error("Position name is required.");

    }

    const numericStipend = Number(stipend);

    if (!Number.isFinite(numericStipend) || numericStipend < 0) {

        throw new Error("Stipend must be a non-negative number.");

    }

    const interval = String(payoutInterval || "monthly").toLowerCase();

    if (!VALID_PAYOUT_INTERVALS.includes(interval)) {

        throw new Error(
            `Payout interval must be one of: ${VALID_PAYOUT_INTERVALS.join(", ")}.`
        );

    }

    const positionRef = db.collection(FINANCE_COLLECTIONS.POSITIONS).doc();

    const data = {

        positionId: positionRef.id,

        name: String(name).trim(),

        stipend: Number(numericStipend.toFixed(2)),

        payoutInterval: interval,

        description: description || "",

        createdBy: createdBy || null,

        createdAt: FieldValue.serverTimestamp(),

        updatedAt: FieldValue.serverTimestamp(),

    };

    await positionRef.set(data);

    return { id: positionRef.id, ...data };

}


async function getPosition(positionId) {

    if (!positionId) {

        throw new Error("Position ID is required.");

    }

    const snap = await db.collection(FINANCE_COLLECTIONS.POSITIONS).doc(positionId).get();

    if (!snap.exists) {

        return null;

    }

    return { id: snap.id, ...snap.data() };

}


async function listPositions() {

    const snapshot = await db.collection(FINANCE_COLLECTIONS.POSITIONS).get();

    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

}


async function updatePosition(positionId, updates = {}) {

    if (!positionId) {

        throw new Error("Position ID is required.");

    }

    const allowed = {};

    if (updates.name !== undefined) allowed.name = String(updates.name).trim();

    if (updates.stipend !== undefined) {

        const numericStipend = Number(updates.stipend);

        if (!Number.isFinite(numericStipend) || numericStipend < 0) {

            throw new Error("Stipend must be a non-negative number.");

        }

        allowed.stipend = Number(numericStipend.toFixed(2));

    }

    if (updates.payoutInterval !== undefined) {

        const interval = String(updates.payoutInterval).toLowerCase();

        if (!VALID_PAYOUT_INTERVALS.includes(interval)) {

            throw new Error(
                `Payout interval must be one of: ${VALID_PAYOUT_INTERVALS.join(", ")}.`
            );

        }

        allowed.payoutInterval = interval;

    }

    if (updates.description !== undefined) allowed.description = updates.description;

    allowed.updatedAt = FieldValue.serverTimestamp();

    const positionRef = db.collection(FINANCE_COLLECTIONS.POSITIONS).doc(positionId);

    await positionRef.update(allowed);

    const snap = await positionRef.get();

    return { id: snap.id, ...snap.data() };

}


module.exports = {

    createPosition,

    getPosition,

    listPositions,

    updatePosition,

    VALID_PAYOUT_INTERVALS,

};
