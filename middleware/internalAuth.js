const crypto = require("crypto");


/*
=========================================================
INTERNAL AUTH MIDDLEWARE
=========================================================

For endpoints called by an external scheduler (not a
logged-in user), e.g. POST /api/internal/compliance-sweep.
requireAuth (Firebase ID token) doesn't apply here — there
is no user session, just a shared secret.

Expected header:

Authorization: Bearer <INTERNAL_SWEEP_SECRET>
=========================================================
*/

function requireInternalSecret(req, res, next) {

    const secret =
        process.env.INTERNAL_SWEEP_SECRET;

    if (!secret) {

        console.error(
            "❌ INTERNAL_SWEEP_SECRET is not configured."
        );

        return res.status(503).json({

            success: false,

            message:
                "Internal endpoint is not configured.",

        });

    }

    const authHeader =
        req.headers.authorization || "";

    if (
        !authHeader.startsWith("Bearer ")
    ) {

        return res.status(401).json({

            success: false,

            message:
                "Authentication is required.",

        });

    }

    const token =
        authHeader.substring(7).trim();

    const tokenBuffer =
        Buffer.from(token);

    const secretBuffer =
        Buffer.from(secret);

    const valid =
        tokenBuffer.length === secretBuffer.length &&
        crypto.timingSafeEqual(tokenBuffer, secretBuffer);

    if (!valid) {

        return res.status(401).json({

            success: false,

            message:
                "Invalid internal credentials.",

        });

    }

    next();

}


module.exports = { requireInternalSecret };
