const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");


/*
=========================================================
BIASHNET SELLER SERVICE
=========================================================

ONE SERVICE FOR ALL SELLER OPERATIONS

RESPONSIBILITIES

1. Seller profile / shop
2. Seller dashboard
3. Seller products
4. Seller product status
5. Seller orders
6. Seller order details
7. Seller earnings
8. Seller statistics

IMPORTANT SECURITY RULE

sellerId MUST ALWAYS come from Firebase Authentication.

NEVER trust:

req.body.sellerId
req.query.sellerId
req.params.sellerId

The controller should pass:

sellerId = authenticated Firebase user UID
=========================================================
*/


/*
=========================================================
HELPERS
=========================================================
*/


function money(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

        return 0;

    }

    return Number(
        number.toFixed(2)
    );

}


function cleanString(value) {

    return String(
        value || ""
    ).trim();

}


/*
=========================================================
GET SELLER
=========================================================
*/

async function getSeller(sellerId) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const sellerRef =
        db
            .collection(
                COLLECTIONS.USERS
            )
            .doc(
                sellerId
            );


    const snapshot =
        await sellerRef.get();


    if (!snapshot.exists) {

        throw new Error(
            "Seller account not found."
        );

    }


    const seller =
        snapshot.data();


    /*
    =====================================================
    SELLER AUTHORIZATION
    =====================================================
    */

    if (
        seller.roles?.seller !== true
    ) {

        throw new Error(
            "This account is not registered as a seller."
        );

    }


    if (
        seller.accountStatus &&
        seller.accountStatus !== "active"
    ) {

        throw new Error(
            "Seller account is not active."
        );

    }


    return {

        id:
            snapshot.id,

        ...seller,

    };

}


/*
=========================================================
GET SELLER SHOP
=========================================================

Returns the seller profile used by the seller dashboard.
=========================================================
*/

async function getShop(sellerId) {

    const seller =
        await getSeller(
            sellerId
        );


    return {

        userId:
            seller.userId ||
            seller.id,

        name:
            seller.name ||
            "",

        email:
            seller.email ||
            "",

        phone:
            seller.phone ||
            "",

        photoURL:
            seller.photoURL ||
            "",

        bio:
            seller.bio ||
            "",

        location:
            seller.location ||
            "",



        verified:
            seller.verified === true,

        sellerVerified:
            seller.roles?.sellerVerified === true,

        badgeLevel:
            seller.badgeLevel ||
            seller.roles?.sellerBadge ||
            null,

        badgeStatus:
            seller.badgeStatus ||
            null,

        sellerBadge:
            seller.roles?.sellerBadge ||
            null,

        sellerRating:
            Number(
                seller.sellerRating || 0
            ),

        totalRatings:
            Number(
                seller.totalRatings || 0
            ),

        listingsCount:
            Number(
                seller.listingsCount || 0
            ),

        followersCount:
            Number(
                seller.followersCount || 0
            ),

        ordersCount:
            Number(
                seller.ordersCount || 0
            ),

        completedOrders:
            Number(
                seller.completedOrders || 0
            ),

        subscriptionActive:
            seller.subscriptionActive === true,

        subscriptionPlan:
            seller.subscriptionPlan ||
            null,

        subscriptionExpiresAt:
            seller.subscriptionExpiresAt ||
            null,

    };

}

/*
=========================================================
GET PUBLIC SELLER
=========================================================

Used when a customer visits a seller storefront.

Example:

GET /api/public/sellers/:sellerId

IMPORTANT:

- sellerId identifies the seller being viewed
- This is NOT the authenticated user's ID
- Never expose private user/account fields
=========================================================
*/

async function getPublicSeller(
    sellerId
) {

    if (!sellerId) {

        const error =
            new Error(
                "Seller ID is required."
            );

        error.statusCode = 400;

        throw error;

    }


    const sellerRef =
        db
            .collection(
                COLLECTIONS.USERS
            )
            .doc(
                sellerId
            );


    const snapshot =
        await sellerRef.get();


    if (!snapshot.exists) {

        const error =
            new Error(
                "Seller not found."
            );

        error.statusCode = 404;

        throw error;

    }


    const seller =
        snapshot.data();


    /*
    =====================================================
    VERIFY SELLER
    =====================================================
    */

    if (
        seller.roles?.seller !== true
    ) {

        const error =
            new Error(
                "This account is not a seller."
            );

        error.statusCode = 404;

        throw error;

    }


    /*
    =====================================================
    ONLY ACTIVE SELLERS ARE PUBLIC
    =====================================================
    */

    if (
        seller.accountStatus &&
        seller.accountStatus !== "active"
    ) {

        const error =
            new Error(
                "This seller is currently unavailable."
            );

        error.statusCode = 404;

        throw error;

    }


    /*
    =====================================================
    SHOP VISIBILITY
    =====================================================
    */

    if (
        seller.shopVisible === false
    ) {

        const error =
            new Error(
                "This seller shop is currently hidden."
            );

        error.statusCode = 404;

        throw error;

    }


    /*
    =====================================================
    PUBLIC SELLER PROFILE
    =====================================================

    NEVER return:

    - email
    - phone
    - roles
    - wallet
    - earnings
    - subscription internals
    - authentication information
    - private account information
    =====================================================
    */

    return {

        id:
            snapshot.id,

        sellerId:
            snapshot.id,

        name:
            seller.name ||
            seller.fullName ||
            "",

        photoURL:
            seller.photoURL ||
            seller.photo ||
            "",

        bio:
            seller.bio ||
            "",

        location:
            seller.location ||
            "",

             /* =====================================================
       PUBLIC CONTACT
       ===================================================== */

    whatsappEnabled:
        seller.whatsappEnabled !== false,

    whatsappNumber:
        seller.whatsappEnabled === false
            ? null
            : (
                seller.sellerWhatsapp ||
                seller.phone ||
                null
            ),

        verified:
            seller.verified === true,

        sellerVerified:
            seller.roles?.sellerVerified === true,

        badgeLevel:
            seller.badgeLevel ||
            seller.roles?.sellerBadge ||
            null,

        sellerBadge:
            seller.roles?.sellerBadge ||
            null,

        sellerRating:
            Number(
                seller.sellerRating ||
                seller.averageRating ||
                0
            ),

        totalRatings:
            Number(
                seller.totalRatings ||
                0
            ),

        listingsCount:
            Number(
                seller.listingsCount ||
                seller.totalListings ||
                0
            ),

        followersCount:
            Number(
                seller.followersCount ||
                0
            ),

        ordersCount:
            Number(
                seller.ordersCount ||
                0
            ),

        completedOrders:
            Number(
                seller.completedOrders ||
                0
            ),

        subscriptionActive:
            seller.subscriptionActive === true,

        subscriptionPlan:
            seller.subscriptionPlan ||
            null,

        subscriptionExpiresAt:
            seller.subscriptionExpiresAt ||
            null,

    };

}

/*
=========================================================
GET PUBLIC SELLER PRODUCTS
=========================================================

Returns products that customers are allowed to see.

Supports:

GET /api/public/sellers/:sellerId/products?page=1&limit=20
GET /api/public/sellers/:sellerId/products?page=2&limit=20
GET /api/public/sellers/:sellerId/products?page=3&limit=20

IMPORTANT:

- sellerId identifies the seller being viewed
- seller must be public and active
- only active products are returned
- products are sorted newest first
- frontend receives explicit hasMore information

Ownership is determined from:

products.userId
=========================================================
*/

async function getPublicSellerProducts(
    sellerId,
    options = {}
) {

    if (!sellerId) {

        const error =
            new Error(
                "Seller ID is required."
            );

        error.statusCode = 400;

        throw error;

    }


    /*
    =====================================================
    VERIFY PUBLIC SELLER
    =====================================================
    */

    const seller =
        await getPublicSeller(
            sellerId
        );


    /*
    =====================================================
    PAGINATION
    =====================================================
    */

    let page =
        Number(
            options.page || 1
        );


    let limit =
        Number(
            options.limit || 20
        );


    if (
        !Number.isInteger(page) ||
        page < 1
    ) {

        page = 1;

    }


    if (
        !Number.isInteger(limit) ||
        limit < 1
    ) {

        limit = 20;

    }


    /*
     * Prevent very large requests.
     */

    if (limit > 50) {

        limit = 50;

    }


    /*
    =====================================================
    LOAD SELLER PRODUCTS
    =====================================================

    We intentionally fetch the seller's public products
    first, then paginate after sorting.

    This guarantees page 1/page 2/page 3 do not return
    the same products.
    =====================================================
    */

    const snapshot =
        await db
            .collection(
                COLLECTIONS.PRODUCTS
            )
            .where(
                "userId",
                "==",
                sellerId
            )
            .where(
                "isActive",
                "==",
                true
            )
            .get();


    /*
    =====================================================
    BUILD PUBLIC PRODUCT LIST
    =====================================================
    */

    const products = [];


    for (
        const productDoc
        of snapshot.docs
    ) {

        const data =
            productDoc.data();


        /*
        =================================================
        BASIC PUBLIC PRODUCT
        =================================================
        */

        products.push({

            id:
                productDoc.id,

            title:
                data.title ||
                "",

            description:
                data.description ||
                "",

            category:
                data.category ||
                "",

            condition:
                data.condition ||
                "",

            price:
                money(
                    data.price
                ),

            markedPrice:
                data.markedPrice !== undefined
                    ? money(
                        data.markedPrice
                    )
                    : null,

            discount:
                Number(
                    data.discount ||
                    0
                ),

            stock:
                Number(
                    data.stock ||
                    0
                ),

            location:
                data.location ||
                seller.location ||
                "",

            images:
                Array.isArray(
                    data.images
                )
                    ? data.images
                    : [],

            image:
                data.image ||
                data.imageUrl ||
                "",

            flashSale:
                data.flashSale === true,

            flashSalePrice:
                data.flashSalePrice !== undefined
                    ? money(
                        data.flashSalePrice
                    )
                    : null,

            flashSaleStart:
                data.flashSaleStart ||
                null,

            flashSaleEnd:
                data.flashSaleEnd ||
                null,

            sellerWhatsapp:
                seller.whatsappEnabled === false
                    ? null
                    : (
                        data.sellerWhatsapp ||
                        null
                    ),

            views:
                Number(
                    data.views ||
                    0
                ),

            createdAt:
                data.createdAt ||
                null,

            updatedAt:
                data.updatedAt ||
                null,

        });

    }


    /*
    =====================================================
    SORT NEWEST FIRST
    =====================================================
    */

    products.sort(
        (a, b) => {

            const aTime =
                a.createdAt?.toMillis
                    ? a.createdAt.toMillis()
                    : (
                        a.createdAt?.seconds
                            ? a.createdAt.seconds * 1000
                            : (
                                a.createdAt
                                    ? new Date(
                                        a.createdAt
                                    ).getTime()
                                    : 0
                            )
                    );


            const bTime =
                b.createdAt?.toMillis
                    ? b.createdAt.toMillis()
                    : (
                        b.createdAt?.seconds
                            ? b.createdAt.seconds * 1000
                            : (
                                b.createdAt
                                    ? new Date(
                                        b.createdAt
                                    ).getTime()
                                    : 0
                            )
                    );


            /*
             * Stable tie-breaker.
             *
             * This helps prevent inconsistent ordering when
             * two products have the same createdAt.
             */

            if (
                bTime === aTime
            ) {

                return String(
                    a.id
                ).localeCompare(
                    String(
                        b.id
                    )
                );

            }


            return bTime - aTime;

        }
    );


    /*
    =====================================================
    TOTAL PUBLIC PRODUCTS
    =====================================================
    */

    const total =
        products.length;


    /*
    =====================================================
    CALCULATE PAGE RANGE
    =====================================================
    */

    const startIndex =
        (page - 1) * limit;


    const endIndex =
        startIndex + limit;


    /*
    =====================================================
    PAGE PRODUCTS
    =====================================================
    */

    const paginatedProducts =
        products.slice(
            startIndex,
            endIndex
        );


    /*
    =====================================================
    HAS MORE
    =====================================================
    */

    const hasMore =
        endIndex < total;


    /*
    =====================================================
    TOTAL PAGES
    =====================================================
    */

    const totalPages =
        total > 0
            ? Math.ceil(
                total / limit
            )
            : 0;


    /*
    =====================================================
    RETURN
    =====================================================
    */

    return {

        seller,

        products:
            paginatedProducts,

        items:
            paginatedProducts,

        count:
            paginatedProducts.length,

        total,

        page,

        limit,

        hasMore,

        totalPages,

    };

}

/* 
=========================================================
FOLLOWER SYSTEM
=========================================================

Firestore:

followers/{sellerId}_{followerId}

Example:

followers/
    SELLER_UID_USER_UID

{
    sellerId,
    followerId,
    createdAt
}

The authenticated user is ALWAYS the follower.

The sellerId comes from the route/controller,
but must never be trusted from the frontend
without validating the seller.
=========================================================
*/


/*
=========================================================
FOLLOW SELLER
=========================================================
*/

async function followSeller(
    followerId,
    sellerId
) {

    if (!followerId) {

        throw new Error(
            "Follower ID is required."
        );

    }

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    /*
     * Prevent following yourself.
     */

    if (
        followerId === sellerId
    ) {

        throw new Error(
            "You cannot follow your own shop."
        );

    }


    /*
     * Make sure the target is actually
     * an active seller.
     */

    await getSeller(
        sellerId
    );


    const followerRef =
        db
            .collection(
                "followers"
            )
            .doc(
                `${sellerId}_${followerId}`
            );


    const followerSnapshot =
        await followerRef.get();


    /*
     * Already following.
     */

    if (
        followerSnapshot.exists
    ) {

        return {

            success: true,

            following: true,

            alreadyFollowing: true,

            sellerId,

            followerId,

        };

    }


    /*
     * Create follower relationship.
     */

    await followerRef.set({

        sellerId,

        followerId,

        createdAt:
            FieldValue.serverTimestamp(),

    });


    /*
     * Increment seller followers count.
     */

    await db
        .collection(
            COLLECTIONS.USERS
        )
        .doc(
            sellerId
        )
        .update({

            followersCount:
                FieldValue.increment(1),

            updatedAt:
                FieldValue.serverTimestamp(),

        });


    /*
     * Return updated count.
     */

    const seller =
        await getSeller(
            sellerId
        );


    return {

        success: true,

        following: true,

        alreadyFollowing: false,

        sellerId,

        followerId,

        followersCount:
            Number(
                seller.followersCount ||
                0
            ),

    };

}


/*
=========================================================
UNFOLLOW SELLER
=========================================================
*/

async function unfollowSeller(
    followerId,
    sellerId
) {

    if (!followerId) {

        throw new Error(
            "Follower ID is required."
        );

    }

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    if (
        followerId === sellerId
    ) {

        throw new Error(
            "You cannot unfollow your own shop."
        );

    }


    await getSeller(
        sellerId
    );


    const followerRef =
        db
            .collection(
                "followers"
            )
            .doc(
                `${sellerId}_${followerId}`
            );


    const followerSnapshot =
        await followerRef.get();


    /*
     * Already not following.
     */

    if (
        !followerSnapshot.exists
    ) {

        const seller =
            await getSeller(
                sellerId
            );

        return {

            success: true,

            following: false,

            alreadyFollowing: false,

            sellerId,

            followerId,

            followersCount:
                Number(
                    seller.followersCount ||
                    0
                ),

        };

    }


    /*
     * Delete relationship.
     */

    await followerRef.delete();


    /*
     * Decrement count.

     * IMPORTANT:
     * Do not allow negative followersCount.
     */

    const seller =
        await getSeller(
            sellerId
        );


    const currentCount =
        Number(
            seller.followersCount ||
            0
        );


    await db
        .collection(
            COLLECTIONS.USERS
        )
        .doc(
            sellerId
        )
        .update({

            followersCount:
                Math.max(
                    currentCount - 1,
                    0
                ),

            updatedAt:
                FieldValue.serverTimestamp(),

        });


    return {

        success: true,

        following: false,

        alreadyFollowing: false,

        sellerId,

        followerId,

        followersCount:
            Math.max(
                currentCount - 1,
                0
            ),

    };

}


/*
=========================================================
CHECK FOLLOW STATUS
=========================================================
*/

async function getFollowStatus(
    followerId,
    sellerId
) {

    if (!followerId) {

        throw new Error(
            "Follower ID is required."
        );

    }

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    await getSeller(
        sellerId
    );


    /*
     * A seller follows themselves
     * conceptually.
     */

    if (
        followerId === sellerId
    ) {

        return {

            following: false,

            isOwner: true,

            sellerId,

            followerId,

        };

    }


    const followerRef =
        db
            .collection(
                "followers"
            )
            .doc(
                `${sellerId}_${followerId}`
            );


    const snapshot =
        await followerRef.get();


    return {

        following:
            snapshot.exists,

        isOwner: false,

        sellerId,

        followerId,

    };

}


/*
=========================================================
GET FOLLOWERS
=========================================================
*/

async function getFollowers(
    sellerId,
    options = {}
) {

    await getSeller(
        sellerId
    );


    let limit =
        Number(
            options.limit || 50
        );


    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {

        limit = 50;

    }


    if (limit > 100) {

        limit = 100;

    }


    const snapshot =
        await db
            .collection(
                "followers"
            )
            .where(
                "sellerId",
                "==",
                sellerId
            )
            .limit(
                limit
            )
            .get();


    const followers = [];


    for (
        const followerDoc
        of snapshot.docs
    ) {

        const data =
            followerDoc.data();


        /*
         * Load public follower profile.
         */

        const userSnapshot =
            await db
                .collection(
                    COLLECTIONS.USERS
                )
                .doc(
                    data.followerId
                )
                .get();


        if (
            !userSnapshot.exists
        ) {

            continue;

        }


        const user =
            userSnapshot.data();


        followers.push({

            id:
                data.followerId,

            name:
                user.name ||
                user.fullName ||
                "",

            photoURL:
                user.photoURL ||
                user.photo ||
                "",

            username:
                user.username ||
                "",

            createdAt:
                data.createdAt ||
                null,

        });

    }


    return {

        followers,

        count:
            followers.length,

    };

}

/*
=========================================================
UPDATE SELLER SHOP
=========================================================

Allowed fields only.

NEVER allow frontend to modify:

roles
verified
sellerVerified
badge
sellerRating
ordersCount
completedOrders
listingsCount
subscription
=========================================================
*/

async function updateShop(
    sellerId,
    data = {}
) {

    await getSeller(
        sellerId
    );


    const updates = {};


    if (
        data.name !== undefined
    ) {

        const name =
            cleanString(
                data.name
            );


        if (!name) {

            throw new Error(
                "Seller name cannot be empty."
            );

        }


        updates.name =
            name;

    }


    if (
        data.bio !== undefined
    ) {

        updates.bio =
            cleanString(
                data.bio
            );

    }


    if (
        data.location !== undefined
    ) {

        updates.location =
            cleanString(
                data.location
            );

    }


    if (
        data.phone !== undefined
    ) {

        updates.phone =
            cleanString(
                data.phone
            );

    }


    if (
        data.photoURL !== undefined
    ) {

        updates.photoURL =
            cleanString(
                data.photoURL
            );

    }


    if (
        Object.keys(
            updates
        ).length === 0
    ) {

        throw new Error(
            "No valid shop fields provided."
        );

    }


    updates.updatedAt =
        FieldValue.serverTimestamp();


    await db
        .collection(
            COLLECTIONS.USERS
        )
        .doc(
            sellerId
        )
        .update(
            updates
        );


    return getShop(
        sellerId
    );

}


/*
=========================================================
GET SELLER PRODUCTS
=========================================================

Uses products.userId because that is the actual
structure of your current products collection.
=========================================================
*/

async function getProducts(
    sellerId,
    options = {}
) {

    await getSeller(
        sellerId
    );


    let limit =
        Number(
            options.limit || 50
        );


    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {

        limit = 50;

    }


    if (limit > 100) {

        limit = 100;

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.PRODUCTS
            )
            .where(
                "userId",
                "==",
                sellerId
            )
            .limit(
                limit
            )
            .get();


    const products =
        snapshot.docs.map(
            doc => ({

                id:
                    doc.id,

                ...doc.data(),

            })
        );


    /*
    =====================================================
    SORT NEWEST FIRST
    =====================================================
    */

    products.sort(
        (a, b) => {

            const aTime =
                a.createdAt?.toMillis
                    ? a.createdAt.toMillis()
                    : 0;

            const bTime =
                b.createdAt?.toMillis
                    ? b.createdAt.toMillis()
                    : 0;

            return bTime - aTime;

        }
    );


    return {

        products,

        count:
            products.length,

    };

}


/*
=========================================================
GET SINGLE SELLER PRODUCT
=========================================================

The product MUST belong to the authenticated seller.
=========================================================
*/

async function getProduct(
    sellerId,
    productId
) {

    await getSeller(
        sellerId
    );


    if (!productId) {

        throw new Error(
            "Product ID is required."
        );

    }


    const productRef =
        db
            .collection(
                COLLECTIONS.PRODUCTS
            )
            .doc(
                productId
            );


    const snapshot =
        await productRef.get();


    if (!snapshot.exists) {

        throw new Error(
            "Product not found."
        );

    }


    const product =
        snapshot.data();


    if (
        product.userId !==
        sellerId
    ) {

        throw new Error(
            "You are not authorized to access this product."
        );

    }


    return {

        id:
            snapshot.id,

        ...product,

    };

}


/*
=========================================================
UPDATE PRODUCT
=========================================================

Seller can update normal product fields.

Ownership is checked from Firestore.
=========================================================
*/

async function updateProduct(
    sellerId,
    productId,
    data = {}
) {

    await getProduct(
        sellerId,
        productId
    );


    const allowedFields = [

        "title",

        "description",

        "category",

        "condition",

        "price",

        "markedPrice",

        "discount",

        "stock",

        "location",

        "keywords",

        "images",

        "isActive",

        "flashSale",

        "flashSalePrice",

        "flashSaleStart",

        "flashSaleEnd",

        "sellerWhatsapp",

    ];


    const updates = {};


    for (
        const field of allowedFields
    ) {

        if (
            data[field] !== undefined
        ) {

            updates[field] =
                data[field];

        }

    }


    /*
    =====================================================
    PRICE VALIDATION
    =====================================================
    */

    if (
        updates.price !== undefined
    ) {

        const price =
            Number(
                updates.price
            );


        if (
            !Number.isFinite(price) ||
            price <= 0
        ) {

            throw new Error(
                "Product price must be greater than zero."
            );

        }


        updates.price =
            money(price);

    }


    /*
    =====================================================
    STOCK VALIDATION
    =====================================================
    */

    if (
        updates.stock !== undefined
    ) {

        const stock =
            Number(
                updates.stock
            );


        if (
            !Number.isInteger(stock) ||
            stock < 0
        ) {

            throw new Error(
                "Stock must be a valid non-negative integer."
            );

        }


        updates.stock =
            stock;

    }


    /*
    =====================================================
    MARKED PRICE
    =====================================================
    */

    if (
        updates.markedPrice !== undefined
    ) {

        updates.markedPrice =
            money(
                updates.markedPrice
            );

    }


    /*
    =====================================================
    DISCOUNT
    =====================================================
    */

    if (
        updates.discount !== undefined
    ) {

        const discount =
            Number(
                updates.discount
            );


        if (
            !Number.isFinite(discount) ||
            discount < 0 ||
            discount > 100
        ) {

            throw new Error(
                "Discount must be between 0 and 100."
            );

        }


        updates.discount =
            discount;

    }


    /*
    =====================================================
    DO NOT ALLOW SELLER TO MODIFY SECURITY FIELDS
    =====================================================
    */

    delete updates.userId;
    delete updates.sellerId;
    delete updates.sellerName;
    delete updates.sellerPhone;
    delete updates.status;
    delete updates.rating;
    delete updates.reviewCount;
    delete updates.views;
    delete updates.createdAt;


    if (
        Object.keys(
            updates
        ).length === 0
    ) {

        throw new Error(
            "No valid product fields provided."
        );

    }


    updates.updatedAt =
        FieldValue.serverTimestamp();


    await db
        .collection(
            COLLECTIONS.PRODUCTS
        )
        .doc(
            productId
        )
        .update(
            updates
        );


    return getProduct(
        sellerId,
        productId
    );

}


/*
=========================================================
ACTIVATE / DEACTIVATE PRODUCT
=========================================================
*/

async function setProductActive(
    sellerId,
    productId,
    isActive
) {

    await getProduct(
        sellerId,
        productId
    );


    if (
        typeof isActive !==
        "boolean"
    ) {

        throw new Error(
            "isActive must be true or false."
        );

    }


    await db
        .collection(
            COLLECTIONS.PRODUCTS
        )
        .doc(
            productId
        )
        .update({

            isActive,

            updatedAt:
                FieldValue.serverTimestamp(),

        });


    return {

        success:
            true,

        productId,

        isActive,

    };

}


/*
=========================================================
DELETE / ARCHIVE PRODUCT
=========================================================

IMPORTANT

We do NOT physically delete the product.

We deactivate it.

This protects historical marketplace orders.
=========================================================
*/

async function deleteProduct(
    sellerId,
    productId
) {

    await getProduct(
        sellerId,
        productId
    );


    await db
        .collection(
            COLLECTIONS.PRODUCTS
        )
        .doc(
            productId
        )
        .update({

            isActive:
                false,

            status:
                "inactive",

            updatedAt:
                FieldValue.serverTimestamp(),

        });


    return {

        success:
            true,

        productId,

        message:
            "Product removed from your shop.",

    };

}


/*
=========================================================
GET SELLER ORDERS
=========================================================

Marketplace orders contain:

sellerBreakdown[]

and:

items[]

Therefore seller orders must be filtered using
sellerIds.

We then extract only the seller's part of every order.
=========================================================
*/

async function getOrders(
    sellerId,
    options = {}
) {

    await getSeller(
        sellerId
    );


    let limit =
        Number(
            options.limit || 50
        );


    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {

        limit = 50;

    }


    if (limit > 100) {

        limit = 100;

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .where(
                "sellerIds",
                "array-contains",
                sellerId
            )
            .limit(
                limit
            )
            .get();


    const orders = [];


    for (
        const doc of snapshot.docs
    ) {

        const order =
            doc.data();


        /*
        =================================================
        EXTRACT SELLER ITEMS
        =================================================
        */

        const sellerItems =
            Array.isArray(
                order.items
            )
                ? order.items.filter(
                    item =>
                        item.sellerId ===
                        sellerId
                )
                : [];


        /*
        =================================================
        SELLER BREAKDOWN
        =================================================
        */

        const sellerBreakdown =
            Array.isArray(
                order.sellerBreakdown
            )
                ? order.sellerBreakdown.find(
                    seller =>
                        seller.sellerId ===
                        sellerId
                )
                : null;


        /*
        =================================================
        SKIP IF NO SELLER DATA
        =================================================
        */

        if (
            !sellerBreakdown &&
            sellerItems.length === 0
        ) {

            continue;

        }


        orders.push({

            id:
                doc.id,

            orderId:
                order.orderId ||
                doc.id,

            buyerId:
                order.buyerId,

            status:
                order.status,

            paymentStatus:
                order.paymentStatus,

            createdAt:
                order.createdAt,

            updatedAt:
                order.updatedAt,

            buyerPhone:
                order.buyerPhone,

            deliveryAddress:
                order.deliveryAddress,

            items:
                sellerItems,

            sellerBreakdown:
                sellerBreakdown || null,

            sellerGross:
                sellerBreakdown
                    ? Number(
                        sellerBreakdown.grossAmount ||
                        0
                    )
                    : 0,

            sellerNet:
                sellerBreakdown
                    ? Number(
                        sellerBreakdown.sellerNet ||
                        0
                    )
                    : 0,

            commissionAmount:
                sellerBreakdown
                    ? Number(
                        sellerBreakdown.commissionAmount ||
                        0
                    )
                    : 0,

            sellerPaymentStatus:
                sellerBreakdown
                    ?.sellerPaymentStatus ||
                null,

            payoutStatus:
                sellerBreakdown
                    ?.payoutStatus ||
                null,

        });

    }


    /*
    =====================================================
    SORT NEWEST FIRST
    =====================================================
    */

    orders.sort(
        (a, b) => {

            const aTime =
                a.createdAt?.toMillis
                    ? a.createdAt.toMillis()
                    : 0;

            const bTime =
                b.createdAt?.toMillis
                    ? b.createdAt.toMillis()
                    : 0;

            return bTime - aTime;

        }
    );


    return {

        orders,

        count:
            orders.length,

    };

}


/*
=========================================================
GET SELLER ORDER
=========================================================
*/

async function getOrder(
    sellerId,
    orderId
) {

    await getSeller(
        sellerId
    );


    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            )
            .get();


    if (!snapshot.exists) {

        throw new Error(
            "Order not found."
        );

    }


    const order =
        snapshot.data();


    /*
    =====================================================
    SELLER AUTHORIZATION
    =====================================================
    */

    if (
        !Array.isArray(
            order.sellerIds
        ) ||
        !order.sellerIds.includes(
            sellerId
        )
    ) {

        throw new Error(
            "You are not authorized to access this order."
        );

    }


    const sellerItems =
        Array.isArray(
            order.items
        )
            ? order.items.filter(
                item =>
                    item.sellerId ===
                    sellerId
            )
            : [];


    const sellerBreakdown =
        Array.isArray(
            order.sellerBreakdown
        )
            ? order.sellerBreakdown.find(
                seller =>
                    seller.sellerId ===
                    sellerId
            )
            : null;


    return {

        id:
            snapshot.id,

        orderId:
            order.orderId ||
            snapshot.id,

        buyerId:
            order.buyerId,

        status:
            order.status,

        paymentStatus:
            order.paymentStatus,

        buyerPhone:
            order.buyerPhone,

        deliveryAddress:
            order.deliveryAddress,

        createdAt:
            order.createdAt,

        updatedAt:
            order.updatedAt,

        items:
            sellerItems,

        sellerBreakdown:
            sellerBreakdown,

    };

}


/*
=========================================================
SELLER DASHBOARD
=========================================================

This combines:

seller
products
orders
financial statistics
=========================================================
*/

async function getDashboard(
    sellerId
) {

    const [
        shop,
        productResult,
        orderResult,
    ] = await Promise.all([

        getShop(
            sellerId
        ),

        getProducts(
            sellerId,
            {
                limit: 100
            }
        ),

        getOrders(
            sellerId,
            {
                limit: 100
            }
        ),

    ]);


    const products =
        productResult.products;


    const orders =
        orderResult.orders;


    /*
    =====================================================
    PRODUCT STATISTICS
    =====================================================
    */

    const totalProducts =
        products.length;


    const activeProducts =
        products.filter(
            product =>
                product.isActive === true
        ).length;


    const inactiveProducts =
        products.filter(
            product =>
                product.isActive !== true
        ).length;


    const totalStock =
        products.reduce(
            (
                total,
                product
            ) =>
                total +
                Number(
                    product.stock || 0
                ),
            0
        );


    /*
    =====================================================
    ORDER STATISTICS
    =====================================================
    */

    const totalOrders =
        orders.length;


    const completedOrders =
        orders.filter(
            order =>
                String(
                    order.status || ""
                ).toUpperCase() ===
                "COMPLETED"
        ).length;


    const pendingOrders =
        orders.filter(
            order =>
                String(
                    order.status || ""
                ).toUpperCase() ===
                "PENDING_PAYMENT"
        ).length;


    const paidOrders =
        orders.filter(
            order =>
                String(
                    order.paymentStatus || ""
                ).toUpperCase() ===
                "SUCCESSFUL"
        ).length;


    /*
    =====================================================
    FINANCIAL STATISTICS
    =====================================================

    ONLY PAID ORDERS COUNT AS SALES.

    Every order document carries a sellerBreakdown from the
    moment it is created — including orders the buyer
    abandoned or whose STK push failed. Summing all of them
    reports money the seller never made and can never
    withdraw, which does not reconcile against the wallet.

    An order counts here once the buyer's payment actually
    succeeded; whether the funds are still in escrow or
    already released is a separate question, answered by
    the wallet's pendingBalance/availableBalance.
    =====================================================
    */

    let grossSales = 0;

    let commission = 0;

    let sellerNet = 0;


    for (
        const order of orders
    ) {

        const paid =
            String(
                order.paymentStatus || ""
            ).toUpperCase() ===
            "SUCCESSFUL";


        if (!paid) {

            continue;

        }


        grossSales +=
            Number(
                order.sellerGross || 0
            );


        commission +=
            Number(
                order.commissionAmount || 0
            );


        sellerNet +=
            Number(
                order.sellerNet || 0
            );

    }


    /*
    =====================================================
    RETURN DASHBOARD
    =====================================================
    */

    return {

        shop,

        statistics: {

            totalProducts,

            activeProducts,

            inactiveProducts,

            totalStock,

            totalOrders,

            completedOrders,

            pendingOrders,

            paidOrders,

            grossSales:
                money(
                    grossSales
                ),

            commission:
                money(
                    commission
                ),

            sellerNet:
                money(
                    sellerNet
                ),

        },

        recentProducts:
            products.slice(
                0,
                10
            ),

        recentOrders:
            orders.slice(
                0,
                10
            ),

    };

}


/*
=========================================================
SELLER SUMMARY
=========================================================

Useful for mobile seller dashboard header.
=========================================================
*/

async function getSummary(
    sellerId
) {

    const shop =
        await getShop(
            sellerId
        );


    const products =
        await getProducts(
            sellerId,
            {
                limit: 100
            }
        );


    const orders =
        await getOrders(
            sellerId,
            {
                limit: 100
            }
        );


    let grossSales = 0;

    let sellerNet = 0;


    /*
    Same rule as getDashboard — an unpaid or failed order is
    not a sale, so it must not inflate the totals.
    */

    orders.orders.forEach(
        order => {

            const paid =
                String(
                    order.paymentStatus || ""
                ).toUpperCase() ===
                "SUCCESSFUL";


            if (!paid) {

                return;

            }


            grossSales +=
                Number(
                    order.sellerGross || 0
                );


            sellerNet +=
                Number(
                    order.sellerNet || 0
                );

        }
    );


    return {

        seller: shop,

        products:
            products.count,

        orders:
            orders.count,

        grossSales:
            money(
                grossSales
            ),

        sellerNet:
            money(
                sellerNet
            ),

    };

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

    getSeller,

    getShop,
    getPublicSeller,
    getPublicSellerProducts,
    updateShop,

    /* FOLLOWERS */

    followSeller,

    unfollowSeller,

    getFollowStatus,

    getFollowers,

    /* PRODUCTS */

    getProducts,

    getProduct,

    updateProduct,

    setProductActive,

    deleteProduct,

    /* ORDERS */

    getOrders,

    getOrder,

    /* DASHBOARD */

    getDashboard,

    getSummary,

};