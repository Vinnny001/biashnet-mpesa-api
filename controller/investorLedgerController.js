const {
    requestInvestorPayout,
    getInvestorLedger,
} = require("../service/investorLedgerService");

const { getFinanceWallet } = require("../service/financeWalletService");


/*
=========================================================
INVESTOR LEDGER CONTROLLER
=========================================================
*/

async function ledger(req, res) {

    try {

        const { investorId } = req.params;

        const transactions = await getInvestorLedger(investorId);

        const wallet = await getFinanceWallet(investorId);

        return res.status(200).json({ success: true, wallet, transactions });

    } catch (error) {

        console.error("❌ Get investor ledger controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to retrieve investor ledger.",

        });

    }

}


async function payout(req, res) {

    try {

        const { investorId } = req.params;

        const { amount } = req.body;

        const result = await requestInvestorPayout({

            investorId,

            amount,

            requestedBy: req.employee.id,

        });

        return res.status(201).json({ success: true, ...result });

    } catch (error) {

        console.error("❌ Investor payout controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to record investor payout.",

        });

    }

}


module.exports = { ledger, payout };
