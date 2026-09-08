const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    FINANCE_COLLECTIONS,
} = require("../config/financeCollections");

const {
    APPROVAL_STATUS,
    APPROVAL_REQUEST_TYPES,
} = require("../config/financeConstants");


/*
=========================================================
BIASHNET APPROVAL SERVICE
=========================================================

PURPOSE
---------------------------------------------------------

Generic approval queue shared by:

- HR role-change requests (CEO approval)
- large expenses (Admin or CEO approval)
- large payroll runs (CEO approval)
- loan entries (CEO approval)
- large investor payouts (CEO approval)

Callers pass an "apply" function describing what actually
happens on approval. The approval document stores enough
`payload` to reconstruct that action if needed, but the
caller decides how to apply it — this service never
guesses at business logic.

IMPORTANT:

approve()/reject() do NOT run the caller's apply()
callback inside the Firestore transaction that flips the
approval status, because apply() may itself need to run
its own Firestore transaction against other collections
(financeWalletAccounts, financeTransactionRecords, etc.)
and Firestore does not support nested transactions.

Instead:

1. Atomically claim the approval (pending -> approved),
   refusing if it is already decided.
2. Run apply() outside that transaction.
3. If apply() throws, the approval is rolled back to
   pending so it can be retried.
=========================================================
*/


function getApprovalRef(requestId) {

    if (!requestId) {

        throw new Error("Approval request ID is required.");

    }

    return db.collection(FINANCE_COLLECTIONS.APPROVAL_REQUESTS).doc(requestId);

}


/* ========================================================
   CREATE APPROVAL REQUEST
======================================================== */

async function createApprovalRequest({

    requestType,

    requestedBy,

    targetId = null,

    requiredLevel,

    payload = {},

    description = "",

}) {

    if (!requestType) {

        throw new Error("Approval request type is required.");

    }

    if (!requestedBy) {

        throw new Error("Requesting user ID is required.");

    }

    if (!requiredLevel) {

        throw new Error("Required approval level is required.");

    }

    const requestRef = db.collection(FINANCE_COLLECTIONS.APPROVAL_REQUESTS).doc();

    const data = {

        requestId: requestRef.id,

        requestType,

        requestedBy,

        targetId,

        requiredLevel,

        payload,

        description,

        status: APPROVAL_STATUS.PENDING,

        approvedBy: null,

        approvedAt: null,

        rejectedBy: null,

        rejectedAt: null,

        createdAt: FieldValue.serverTimestamp(),

        updatedAt: FieldValue.serverTimestamp(),

    };

    await requestRef.set(data);

    return { id: requestRef.id, ...data };

}


/* ========================================================
   GET / LIST
======================================================== */

async function getApprovalRequest(requestId) {

    const snap = await getApprovalRef(requestId).get();

    if (!snap.exists) {

        return null;

    }

    return { id: snap.id, ...snap.data() };

}


async function listPendingApprovals({ requiredLevel } = {}) {

    let query = db
        .collection(FINANCE_COLLECTIONS.APPROVAL_REQUESTS)
        .where("status", "==", APPROVAL_STATUS.PENDING);

    if (requiredLevel) {

        query = query.where("requiredLevel", "==", requiredLevel);

    }

    const snapshot = await query.get();

    /*
     * ROLE_CHANGE requests are now created/resolved natively by
     * backend (same shared approvalRequests collection) — exclude
     * them here so mpesa-api's own queue only ever shows the
     * financial request types it still owns.
     */
    return snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }))
        .filter((request) => request.requestType !== APPROVAL_REQUEST_TYPES.ROLE_CHANGE);

}


/* ========================================================
   CLAIM (internal)
======================================================== */

async function claimApproval(requestId, nextStatus, actorField, actorId) {

    const requestRef = getApprovalRef(requestId);

    let claimed;

    await db.runTransaction(async (transaction) => {

        const snap = await transaction.get(requestRef);

        if (!snap.exists) {

            throw new Error("Approval request not found.");

        }

        const request = snap.data();

        if (request.status !== APPROVAL_STATUS.PENDING) {

            throw new Error(
                `Approval request has already been ${request.status}.`
            );

        }

        const updates = {

            status: nextStatus,

            updatedAt: FieldValue.serverTimestamp(),

        };

        updates[actorField] = actorId;

        updates[nextStatus === APPROVAL_STATUS.APPROVED ? "approvedAt" : "rejectedAt"] =
            FieldValue.serverTimestamp();

        transaction.update(requestRef, updates);

        claimed = { id: requestRef.id, ...request, ...updates };

    });

    return claimed;

}


async function revertToPending(requestId) {

    await getApprovalRef(requestId).update({

        status: APPROVAL_STATUS.PENDING,

        approvedBy: null,

        approvedAt: null,

        updatedAt: FieldValue.serverTimestamp(),

    });

}


/* ========================================================
   APPROVE
======================================================== */

async function approveRequest(requestId, approvedBy, applyFn) {

    if (typeof applyFn !== "function") {

        throw new Error("An apply() callback is required to approve a request.");

    }

    const claimed = await claimApproval(
        requestId,
        APPROVAL_STATUS.APPROVED,
        "approvedBy",
        approvedBy
    );

    try {

        const applyResult = await applyFn(claimed.payload, claimed);

        return { success: true, request: claimed, result: applyResult };

    } catch (error) {

        await revertToPending(requestId);

        throw error;

    }

}


/* ========================================================
   REJECT
======================================================== */

async function rejectRequest(requestId, rejectedBy, reason = "") {

    const claimed = await claimApproval(
        requestId,
        APPROVAL_STATUS.REJECTED,
        "rejectedBy",
        rejectedBy
    );

    if (reason) {

        await getApprovalRef(requestId).update({ rejectionReason: reason });

    }

    return { success: true, request: claimed };

}


module.exports = {

    createApprovalRequest,

    getApprovalRequest,

    listPendingApprovals,

    approveRequest,

    rejectRequest,

};
