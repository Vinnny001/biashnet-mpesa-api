const {
    createFinanceWithdrawal,
    getFinanceWithdrawal,
    getOwnerFinanceWithdrawals,
} = require("../service/financeWithdrawalService");

const {
    getFinanceWallet,
} = require("../service/financeWalletService");

const {
    FINANCE_OWNER_TYPES,
} = require("../config/financeConstants");


/*
=========================================================
FINANCE WITHDRAWAL CONTROLLER
=========================================================

Any employee/investor can withdraw their own
financeWalletAccounts balance. ownerId is always taken
from the authenticated Firebase user, never the request
body.
=========================================================
*/

async function create(req, res) {

    try {

        const ownerId = req.user?.uid;

        if (!ownerId) {

            return res.status(401).json({

                success: false,

                message: "Authenticated user not found.",

            });

        }

        const { amount, phoneNumber, ownerType } = req.body;

        const withdrawal = await createFinanceWithdrawal({

            ownerId,

            ownerType,

            amount,

            phoneNumber,

        });

        return res.status(201).json({ success: true, withdrawal });

    } catch (error) {

        console.error("❌ Create finance withdrawal controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to create withdrawal.",

        });

    }

}


async function getOne(req, res) {

    try {

        const ownerId = req.user?.uid;

        const { withdrawalId } = req.params;

        const withdrawal = await getFinanceWithdrawal(withdrawalId, ownerId);

        if (!withdrawal) {

            return res.status(404).json({

                success: false,

                message: "Withdrawal not found.",

            });

        }

        return res.status(200).json({ success: true, withdrawal });

    } catch (error) {

        console.error("❌ Get finance withdrawal controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to retrieve withdrawal.",

        });

    }

}


async function getWallet(req, res) {

    try {

        const ownerId = req.user?.uid;

        if (!ownerId) {

            return res.status(401).json({

                success: false,

                message: "Authenticated user not found.",

            });

        }

        /*
        A person can hold more than one finance wallet (employee AND
        investor are separate pots). The caller says which one it wants;
        the employee wallet is the default since that's what the work
        dashboard shows.
        */
        const ownerType =
            req.query?.ownerType || FINANCE_OWNER_TYPES.EMPLOYEE;

        const wallet = await getFinanceWallet(ownerId, ownerType);

        return res.status(200).json({ success: true, wallet: wallet || null });

    } catch (error) {

        console.error("❌ Get finance wallet controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to retrieve wallet.",

        });

    }

}


async function getMine(req, res) {

    try {

        const ownerId = req.user?.uid;

        const withdrawals = await getOwnerFinanceWithdrawals(ownerId);

        return res.status(200).json({ success: true, withdrawals });

    } catch (error) {

        console.error("❌ Get my finance withdrawals controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to retrieve withdrawals.",

        });

    }

}


module.exports = { create, getOne, getMine, getWallet };
