const sellerService = require("../service/sellerService");


/*
=========================================================
BIASHNET SELLER CONTROLLER
=========================================================

RESPONSIBILITY

The controller handles:

- HTTP requests
- Authentication identity
- Request parameters
- Request body
- Response formatting
- HTTP errors

Business logic belongs in sellerService.js.

IMPORTANT:

sellerId ALWAYS comes from:

    req.user.uid

NEVER from:

    req.body.sellerId
    req.query.sellerId
    req.params.sellerId
=========================================================
*/


/*
=========================================================
HELPER — GET AUTHENTICATED SELLER ID
=========================================================
*/

function getSellerId(req) {

    const sellerId =
        req.user?.uid;


    if (!sellerId) {

        const error =
            new Error(
                "Authentication required."
            );

        error.statusCode = 401;

        throw error;

    }


    return sellerId;

}


/*
=========================================================
ERROR HANDLER
=========================================================
*/

function handleError(
    res,
    error
) {

    console.error(
        "Seller controller error:",
        error
    );


    const statusCode =
        error.statusCode ||
        400;


    return res.status(
        statusCode
    ).json({

        success:
            false,

        message:
            error.message ||
            "Seller request failed.",

    });

}


/*
=========================================================
GET SELLER SHOP
=========================================================

GET /api/seller/shop
=========================================================
*/

async function getShop(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const shop =
            await sellerService.getShop(
                sellerId
            );


        return res.json({

            success:
                true,

            shop,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
UPDATE SELLER SHOP
=========================================================

PATCH /api/seller/shop
=========================================================
*/

async function updateShop(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const shop =
            await sellerService.updateShop(
                sellerId,
                req.body
            );


        return res.json({

            success:
                true,

            message:
                "Shop updated successfully.",

            shop,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
GET SELLER PRODUCTS
=========================================================

GET /api/seller/products?limit=100
=========================================================
*/

async function getProducts(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const result =
            await sellerService.getProducts(
                sellerId,
                {
                    limit:
                        req.query.limit,
                }
            );


        return res.json({

            success:
                true,

            ...result,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
GET SINGLE SELLER PRODUCT
=========================================================

GET /api/seller/products/:productId
=========================================================
*/

async function getProduct(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const product =
            await sellerService.getProduct(
                sellerId,
                req.params.productId
            );


        return res.json({

            success:
                true,

            product,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
UPDATE SELLER PRODUCT
=========================================================

PATCH /api/seller/products/:productId
=========================================================
*/

async function updateProduct(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const product =
            await sellerService.updateProduct(
                sellerId,
                req.params.productId,
                req.body
            );


        return res.json({

            success:
                true,

            message:
                "Product updated successfully.",

            product,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
ACTIVATE / DEACTIVATE PRODUCT
=========================================================

PATCH /api/seller/products/:productId/status

BODY:

{
    "isActive": true
}

or

{
    "isActive": false
}
=========================================================
*/

async function setProductActive(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const result =
            await sellerService.setProductActive(
                sellerId,
                req.params.productId,
                req.body.isActive
            );


        return res.json({

            ...result,

            message:
                req.body.isActive
                    ? "Product activated successfully."
                    : "Product deactivated successfully.",

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
DELETE / ARCHIVE PRODUCT
=========================================================

DELETE /api/seller/products/:productId

This does NOT physically delete the Firestore document.

The service marks it inactive.
=========================================================
*/

async function deleteProduct(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const result =
            await sellerService.deleteProduct(
                sellerId,
                req.params.productId
            );


        return res.json(
            result
        );

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
GET SELLER ORDERS
=========================================================

GET /api/seller/orders?limit=100
=========================================================
*/

async function getOrders(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const result =
            await sellerService.getOrders(
                sellerId,
                {
                    limit:
                        req.query.limit,
                }
            );


        return res.json({

            success:
                true,

            ...result,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
GET SINGLE SELLER ORDER
=========================================================

GET /api/seller/orders/:orderId
=========================================================
*/

async function getOrder(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const order =
            await sellerService.getOrder(
                sellerId,
                req.params.orderId
            );


        return res.json({

            success:
                true,

            order,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
SELLER DASHBOARD
=========================================================

GET /api/seller/dashboard
=========================================================
*/

async function getDashboard(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const dashboard =
            await sellerService.getDashboard(
                sellerId
            );


        return res.json({

            success:
                true,

            ...dashboard,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

 }


/*
=========================================================
SELLER SUMMARY
=========================================================

GET /api/seller/summary
=========================================================
*/

async function getSummary(
    req,
    res
) {

    try {

        const sellerId =
            getSellerId(
                req
            );


        const summary =
            await sellerService.getSummary(
                sellerId
            );


        return res.json({

            success:
                true,

            ...summary,

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

 }



/*
=========================================================
GET FOLLOW STATUS
=========================================================

GET /api/seller/:sellerId/follow-status

followerId = authenticated user
sellerId   = seller being viewed

ANY AUTHENTICATED USER CAN FOLLOW A SELLER.
=========================================================
*/

async function getFollowStatus(
    req,
    res
) {

    try {

        const followerId =
            getSellerId(req);

        const sellerId =
            req.params.sellerId;


        if (!sellerId) {

            return res.status(400).json({

                success: false,

                message:
                    "Seller ID is required."

            });

        }


        const result =
            await sellerService.getFollowStatus(
                followerId,
                sellerId
            );


        return res.json({

            success: true,

            ...result

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
FOLLOW SELLER
=========================================================

POST /api/seller/:sellerId/follow

ANY AUTHENTICATED USER CAN FOLLOW A SELLER.
=========================================================
*/

async function followSeller(
    req,
    res
) {

    try {

        const followerId =
            getSellerId(req);

        const sellerId =
            req.params.sellerId;


        if (!sellerId) {

            return res.status(400).json({

                success: false,

                message:
                    "Seller ID is required."

            });

        }


        /*
        IMPORTANT:

        service signature is:

        followSeller(
            followerId,
            sellerId
        )
        */

        const result =
            await sellerService.followSeller(
                followerId,
                sellerId
            );


        return res.status(
            result.alreadyFollowing
                ? 200
                : 201
        ).json({

            success: true,

            ...result

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}


/*
=========================================================
UNFOLLOW SELLER
=========================================================

DELETE /api/seller/:sellerId/follow
=========================================================
*/

async function unfollowSeller(
    req,
    res
) {

    try {

        const followerId =
            getSellerId(req);

        const sellerId =
            req.params.sellerId;


        if (!sellerId) {

            return res.status(400).json({

                success: false,

                message:
                    "Seller ID is required."

            });

        }


        /*
        service signature:

        unfollowSeller(
            followerId,
            sellerId
        )
        */

        const result =
            await sellerService.unfollowSeller(
                followerId,
                sellerId
            );


        return res.json({

            success: true,

            ...result

        });

    } catch (error) {

        return handleError(
            res,
            error
        );

    }

}
/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    getShop,

    updateShop,

    getProducts,

    getProduct,

    updateProduct,

    setProductActive,

    deleteProduct,

    getOrders,

    getOrder,

    getDashboard,

    getSummary,
    getFollowStatus,
followSeller,
unfollowSeller,

};