const sellerService = require("../service/sellerService");


/*
=========================================================
GET PUBLIC SELLER
=========================================================
*/

async function getPublicSeller(
    req,
    res
) {

    try {

        const sellerId =
            req.params.sellerId;


        if (!sellerId) {

            return res.status(400).json({

                success: false,

                message:
                    "Seller ID is required."

            });

        }


        const seller =
            await sellerService.getPublicSeller(
                sellerId
            );


        return res.json({

            success: true,

            seller

        });

    } catch (error) {

        console.error(
            "Public seller error:",
            error
        );


        return res.status(
            error.statusCode || 400
        ).json({

            success: false,

            message:
                error.message ||
                "Unable to load seller."

        });

    }

}


/*
=========================================================
GET PUBLIC SELLER PRODUCTS
=========================================================
*/

async function getPublicSellerProducts(
    req,
    res
) {

    try {

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
            await sellerService.getPublicSellerProducts(
                sellerId,
                {
                    limit:
                        req.query.limit
                }
            );


        return res.json({

            success: true,

            ...result

        });

    } catch (error) {

        console.error(
            "Public seller products error:",
            error
        );


        return res.status(
            error.statusCode || 400
        ).json({

            success: false,

            message:
                error.message ||
                "Unable to load seller products."

        });

    }

}


module.exports = {

    getPublicSeller,

    getPublicSellerProducts,

};