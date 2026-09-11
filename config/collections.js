/*
=========================================================
BIASHNET PAYMENT COLLECTIONS
=========================================================
*/

const COLLECTIONS = {
    USERS:
        "users",
    PRODUCTS:
        "products",

    ORDERS:
        "marketplaceOrders",

    SUB_ORDERS:
        "marketplaceSubOrders",

    MARKETPLACE_RECEIPTS:
  "marketplaceReceipts",

    PAYMENTS:
        "marketplacePayments",

    TRANSACTIONS:
        "marketplaceTransactions",

    WALLETS:
        "marketplaceWallets",

    WITHDRAWALS:
        "marketplaceWithdrawals",

    REFUNDS:
        "marketplaceRefunds",

    STK_REQUESTS:
        "stkRequests",

    PENDING_TRANSACTIONS:
        "pendingTransactions",

    PAYMENT_IDEMPOTENCY:
        "paymentIdempotency",

    PAYMENT_SETTINGS:
        "marketplaceSettings",

    NOTIFICATIONS:
    "notifications",

};

/*
=========================================================
MARKETPLACE WALLET OWNER TYPES
=========================================================

A buyer wallet and a seller wallet are separate pots of
money even when they belong to the same person — someone
selling on Biashnet must not see their seller earnings
while shopping as a buyer.
=========================================================
*/

const MARKETPLACE_WALLET_OWNER_TYPES = {

    SELLER: "seller",

    BUYER: "buyer",

};


/*
=========================================================
MARKETPLACE WALLET ID
=========================================================

Seller wallets keep the legacy bare-uid key. Every wallet
document that exists today is a seller wallet holding real
balances (including escrow held against live orders), and
other code/services already address them as
marketplaceWallets/{uid} — re-keying those would move real
money for no functional gain.

Buyer wallets are therefore given their own namespace
instead. The asymmetry is deliberate: it buys full
buyer/seller separation with zero migration of live funds.
=========================================================
*/

function marketplaceWalletId(userId, ownerType) {

    if (!userId) {

        throw new Error("User ID is required.");

    }

    if (ownerType === MARKETPLACE_WALLET_OWNER_TYPES.BUYER) {

        return `buyer_${userId}`;

    }

    return userId;

}


module.exports = {
    COLLECTIONS,
    MARKETPLACE_WALLET_OWNER_TYPES,
    marketplaceWalletId,
};