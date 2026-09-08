const { admin } = require("../config/firebase");

const { verifyBackendJwt } = require("../utils/backendJwt");


/*
=========================================================
AUTHENTICATION MIDDLEWARE
=========================================================

IMPORTANT — two token types are accepted here:

1. The main `backend` service's own HS256 JWT (this is
   what the actual frontend sends for every logged-in
   user — see backend/src/utils/jwt.js and
   utils/backendJwt.js here). Verified locally, no
   network call, tried first since it's the common case.

2. A real Firebase ID token (admin.auth().verifyIdToken),
   for any caller that authenticates directly against
   Firebase instead of going through the backend's login
   flow. Tried as a fallback.

Previously this ONLY accepted (2), which meant every
request carrying the token the app actually sends (1) was
rejected with 401 — the entire authenticated surface of
this service (checkout, orders, withdrawals, employees,
logistics, everything using requireAuth) was unreachable
by real logged-in users.
=========================================================
*/

async function requireAuth(req, res, next) {

    try {

        const authHeader =
            req.headers.authorization;


        if (!authHeader) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is required."

            });

        }


        if (
            !authHeader.startsWith("Bearer ")
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid authentication format."

            });

        }


        const token =
            authHeader.substring(
                7
            ).trim();


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is missing."

            });

        }


        /*
        =====================================================
        1. TRY THE BACKEND'S OWN JWT (the common case)
        =====================================================
        */

        try {

            const payload =
                verifyBackendJwt(
                    token,
                    process.env.JWT_SECRET
                );

            req.user = {

                uid:
                    payload.uid,

                role:
                    payload.role || null,

                ...payload,

            };

            return next();

        } catch (backendJwtError) {

            /*
            Not a valid backend JWT (or JWT_SECRET isn't
            configured) — fall through and try it as a real
            Firebase ID token instead.
            */

        }


        /*
        =====================================================
        2. FALL BACK TO A REAL FIREBASE ID TOKEN
        =====================================================
        */

        const decodedToken =
            await admin
                .auth()
                .verifyIdToken(token);

        req.user =
            decodedToken;


        next();


    } catch (error) {

        console.error(
            "❌ Authentication error:",
            error.code || error.message
        );

        return res.status(401).json({

            success: false,

            message:
                "Invalid or expired authentication token.",

            debug:
                process.env.NODE_ENV !==
                "production"
                    ? error.message
                    : undefined,

        });

    }

}


module.exports = {
    requireAuth
};
