const { db } = require("../config/firebase");

const { FINANCE_COLLECTIONS } = require("../config/financeCollections");

const { EMPLOYMENT_STATUS } = require("../config/financeConstants");


/*
=========================================================
EMPLOYEE AUTHORIZATION MIDDLEWARE
=========================================================

FLOW:

Firebase token
      ↓
requireAuth
      ↓
req.user.uid
      ↓
employees/{uid}
      ↓
verify employmentStatus
      ↓
req.employee
      ↓
employee controller

Mirrors middleware/sellerAuth.js.
=========================================================
*/

async function employeeAuth(req, res, next) {

    try {

        const userId = req.user?.uid;

        if (!userId) {

            return res.status(401).json({

                success: false,

                message: "Authentication is required.",

            });

        }

        const employeeRef = db
            .collection(FINANCE_COLLECTIONS.EMPLOYEES)
            .doc(userId);

        const employeeSnap = await employeeRef.get();

        if (!employeeSnap.exists) {

            return res.status(403).json({

                success: false,

                message: "Employee account required.",

            });

        }

        const employee = employeeSnap.data();

        if (employee.employmentStatus !== EMPLOYMENT_STATUS.ACTIVE) {

            return res.status(403).json({

                success: false,

                message: "Your employee account is not active.",

            });

        }

        req.employee = {

            id: userId,

            uid: userId,

            ...employee,

        };

        next();

    } catch (error) {

        console.error("❌ Employee authorization error:", error);

        return res.status(500).json({

            success: false,

            message: "Unable to verify employee permissions.",

        });

    }

}


module.exports = { employeeAuth };
