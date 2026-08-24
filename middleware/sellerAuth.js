const { db } = require("../config/firebase");


/*
=========================================================
SELLER AUTHORIZATION MIDDLEWARE
=========================================================

FLOW:

Firebase token
      ↓
requireAuth
      ↓
req.user.uid
      ↓
users/{uid}
      ↓
verify seller role/status
      ↓
req.seller
      ↓
seller controller


IMPORTANT:

There is NO sellers collection in the current
BIASHNET structure.

Seller information lives in:

users/{uid}

Example:

users/{uid}
    roles.seller: true
    accountStatus: "active"
    sellerVerified: true
    sellerBadge: "golden"
    name
    email
    phone
    photoURL
    listingsCount
    ...
=========================================================
*/

async function sellerAuth(
    req,
    res,
    next
) {

    try {

        /*
        =================================================
        GET AUTHENTICATED FIREBASE USER
        =================================================
        */

        const userId =
            req.user?.uid;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication is required."

            });

        }


        /*
        =================================================
        GET USER PROFILE
        =================================================
        */

        const userRef =
            db
                .collection("users")
                .doc(userId);


        const userSnap =
            await userRef.get();


        /*
        =================================================
        USER NOT FOUND
        =================================================
        */

        if (!userSnap.exists) {

            return res.status(403).json({

                success: false,

                message:
                    "BIASHNET user profile not found."

            });

        }


        const user =
            userSnap.data();


        /*
        =================================================
        VERIFY SELLER ROLE
        =================================================
        */

        const isSeller =
            user.roles?.seller === true;


        if (!isSeller) {

            return res.status(403).json({

                success: false,

                message:
                    "Seller account required."

            });

        }


        /*
        =================================================
        CHECK ACCOUNT STATUS
        =================================================
        */

        const accountStatus =
            String(
                user.accountStatus || ""
            )
                .trim()
                .toLowerCase();


        if (
            accountStatus &&
            accountStatus !== "active"
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "Your BIASHNET account is not active."

            });

        }


        /*
        =================================================
        EXPLICIT SELLER DISABLE CHECK
        =================================================
        */

        if (
            user.sellerActive === false
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "Your seller account is disabled."

            });

        }


        /*
        =================================================
        ATTACH SELLER
        =================================================

        The controller/service can now use:

            req.seller.id

        as the authenticated seller UID.
        =================================================
        */

        req.seller = {

            id:
                userId,

            uid:
                userId,

            ...user

        };


        /*
        =================================================
        CONTINUE
        =================================================
        */

        next();


    } catch (error) {

        console.error(
            "❌ Seller authorization error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to verify seller permissions."

        });

    }

}


module.exports = {

    sellerAuth

};