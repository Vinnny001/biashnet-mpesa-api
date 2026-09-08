const express = require("express");

const router = express.Router();

const { create, getOne, getMine, getWallet } = require("../controller/financeWithdrawalController");

const { requireAuth } = require("../middleware/auth");


/*
=========================================================
FINANCE WITHDRAWAL ROUTES
=========================================================

Base path: /api/finance-withdrawals

Any authenticated Firebase user with a financeWalletAccounts
balance (employees, investors) can withdraw — the only
requirement is requireAuth, mirroring route/withdrawalRoutes.js.

POST /                     create a withdrawal
GET  /                     my withdrawals
GET  /wallet                my financeWalletAccounts balance
GET  /:withdrawalId        one withdrawal (owner only)
=========================================================
*/

router.post("/", requireAuth, create);

router.get("/", requireAuth, getMine);

router.get("/wallet", requireAuth, getWallet);

router.get("/:withdrawalId", requireAuth, getOne);


module.exports = router;
