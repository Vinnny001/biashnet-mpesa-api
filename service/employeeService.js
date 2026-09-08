const {
    db,
    FieldValue,
} = require("../config/firebase");

const { FINANCE_COLLECTIONS } = require("../config/financeCollections");

const {
    EMPLOYMENT_STATUS,
    EMPLOYEE_ROLE_KEYS,
    APPROVAL_LEVEL,
    APPROVAL_REQUEST_TYPES,
} = require("../config/financeConstants");

const {
    createApprovalRequest,
} = require("./approvalService");

const {
    createFinanceWalletIfNotExists,
} = require("./financeWalletService");

const {
    createNotification,
} = require("./notificationService");


/*
=========================================================
EMPLOYEE SERVICE
=========================================================

employees/{uid}

{
  employeeId, userId, positionId,
  roles: { ceo, hr, accountant, techlead, marketing, admin, logistics },
  employmentStatus, addedBy, createdAt, updatedAt
}

IMPORTANT:

This service never writes to users/{uid}. It only links an
existing Firebase user (by uid) into the employees
collection.
=========================================================
*/

function normalizeRoles(roles = {}) {

    const normalized = {};

    EMPLOYEE_ROLE_KEYS.forEach((key) => {

        normalized[key] = roles[key] === true;

    });

    return normalized;

}


async function createEmployee({

    userId,

    positionId,

    roles = {},

    addedBy,

}) {

    if (!userId) {

        throw new Error("User ID is required.");

    }

    if (!positionId) {

        throw new Error("Position ID is required.");

    }

    const positionSnap = await db
        .collection(FINANCE_COLLECTIONS.POSITIONS)
        .doc(positionId)
        .get();

    if (!positionSnap.exists) {

        throw new Error("Position not found.");

    }

    const employeeRef = db.collection(FINANCE_COLLECTIONS.EMPLOYEES).doc(userId);

    const existing = await employeeRef.get();

    if (existing.exists) {

        throw new Error("This user is already an employee.");

    }

    const data = {

        employeeId: userId,

        userId,

        positionId,

        roles: normalizeRoles(roles),

        employmentStatus: EMPLOYMENT_STATUS.ACTIVE,

        addedBy: addedBy || null,

        createdAt: FieldValue.serverTimestamp(),

        updatedAt: FieldValue.serverTimestamp(),

    };

    await employeeRef.set(data);

    await createFinanceWalletIfNotExists(userId, "employee");

    return { id: userId, ...data };

}


async function getEmployee(employeeId) {

    if (!employeeId) {

        throw new Error("Employee ID is required.");

    }

    const snap = await db.collection(FINANCE_COLLECTIONS.EMPLOYEES).doc(employeeId).get();

    if (!snap.exists) {

        return null;

    }

    return { id: snap.id, ...snap.data() };

}


async function listEmployees() {

    const snapshot = await db.collection(FINANCE_COLLECTIONS.EMPLOYEES).get();

    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

}


/* ========================================================
   DIRECT UPDATES (no approval required)
======================================================== */

async function updateEmployeeStatus(employeeId, employmentStatus) {

    if (!Object.values(EMPLOYMENT_STATUS).includes(employmentStatus)) {

        throw new Error(
            `Employment status must be one of: ${Object.values(EMPLOYMENT_STATUS).join(", ")}.`
        );

    }

    const employeeRef = db.collection(FINANCE_COLLECTIONS.EMPLOYEES).doc(employeeId);

    const snap = await employeeRef.get();

    if (!snap.exists) {

        throw new Error("Employee not found.");

    }

    await employeeRef.update({

        employmentStatus,

        updatedAt: FieldValue.serverTimestamp(),

    });

    return { id: employeeId, ...snap.data(), employmentStatus };

}


async function updateEmployeePosition(employeeId, positionId) {

    const positionSnap = await db
        .collection(FINANCE_COLLECTIONS.POSITIONS)
        .doc(positionId)
        .get();

    if (!positionSnap.exists) {

        throw new Error("Position not found.");

    }

    const employeeRef = db.collection(FINANCE_COLLECTIONS.EMPLOYEES).doc(employeeId);

    const snap = await employeeRef.get();

    if (!snap.exists) {

        throw new Error("Employee not found.");

    }

    await employeeRef.update({

        positionId,

        updatedAt: FieldValue.serverTimestamp(),

    });

    return { id: employeeId, ...snap.data(), positionId };

}


/* ========================================================
   ROLE CHANGE — REQUIRES CEO APPROVAL
======================================================== */

async function requestRoleChange({

    employeeId,

    proposedRoles,

    requestedBy,

}) {

    const employeeSnap = await db
        .collection(FINANCE_COLLECTIONS.EMPLOYEES)
        .doc(employeeId)
        .get();

    if (!employeeSnap.exists) {

        throw new Error("Employee not found.");

    }

    const invalidKeys = Object.keys(proposedRoles || {}).filter(
        (key) => !EMPLOYEE_ROLE_KEYS.includes(key)
    );

    if (invalidKeys.length > 0) {

        throw new Error(`Unknown role key(s): ${invalidKeys.join(", ")}.`);
    }

    const request = await createApprovalRequest({

        requestType: APPROVAL_REQUEST_TYPES.ROLE_CHANGE,

        requestedBy,

        targetId: employeeId,

        requiredLevel: APPROVAL_LEVEL.CEO,

        payload: {

            employeeId,

            proposedRoles: normalizeRoles({
                ...employeeSnap.data().roles,
                ...proposedRoles,
            }),

        },

        description: `Role change for employee ${employeeId}`,

    });

    const employee = employeeSnap.data();

    await createNotification(employeeId, {

        title: "Role change requested",

        message: "HR has requested a role change for your account. It is awaiting CEO approval.",

        type: "ROLE_CHANGE_REQUESTED",

    }).catch(() => {});

    return request;

}


/* ========================================================
   APPLY ROLE CHANGE (called by approvalService on approve)
======================================================== */

async function applyRoleChange(payload) {

    const { employeeId, proposedRoles } = payload;

    const employeeRef = db.collection(FINANCE_COLLECTIONS.EMPLOYEES).doc(employeeId);

    const snap = await employeeRef.get();

    if (!snap.exists) {

        throw new Error("Employee not found.");

    }

    await employeeRef.update({

        roles: normalizeRoles(proposedRoles),

        updatedAt: FieldValue.serverTimestamp(),

    });

    await createNotification(employeeId, {

        title: "Role change approved",

        message: "Your role change has been approved by the CEO and is now active.",

        type: "ROLE_CHANGE_APPROVED",

    }).catch(() => {});

    return { employeeId, roles: normalizeRoles(proposedRoles) };

}


module.exports = {

    createEmployee,

    getEmployee,

    listEmployees,

    updateEmployeeStatus,

    updateEmployeePosition,

    requestRoleChange,

    applyRoleChange,

    normalizeRoles,

};
