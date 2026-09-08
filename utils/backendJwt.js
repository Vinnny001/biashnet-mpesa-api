const crypto = require("crypto");


/*
=========================================================
BACKEND JWT VERIFIER
=========================================================

The main `backend` service (auth/users) does NOT issue
real Firebase ID tokens to the frontend — it issues its
own hand-rolled HS256 JWT (see backend/src/utils/jwt.js:
signToken/verifyToken), signed with JWT_SECRET, payload
shape { uid, role, iat, exp }. `uid` is the real Firebase
Auth UID (backend derives it via `auth.getUser(...)`
before signing), so it's safe to use directly for
Firestore lookups here.

This mirrors that exact verification (same HMAC-SHA256
over `${header}.${payload}`, same base64url encoding,
same constant-time signature comparison) so this service
can accept the token the app actually sends. Both services
MUST share the same JWT_SECRET value.

middleware/auth.js tries this first (fast, no network
call) and falls back to real Firebase ID token
verification (admin.auth().verifyIdToken) for any caller
that authenticates directly against Firebase instead of
going through the backend's login flow.
=========================================================
*/

function verifyBackendJwt(token, secret) {

    if (!secret) {

        throw new Error(
            "JWT_SECRET is not configured."
        );

    }

    const parts =
        String(token || "").split(".");

    if (parts.length !== 3) {

        throw new Error(
            "Malformed token."
        );

    }

    const [
        encodedHeader,
        encodedPayload,
        signature,
    ] = parts;

    const expectedSignature =
        crypto
            .createHmac("sha256", secret)
            .update(`${encodedHeader}.${encodedPayload}`)
            .digest("base64url");

    const actualBuffer =
        Buffer.from(signature);

    const expectedBuffer =
        Buffer.from(expectedSignature);

    const validSignature =
        actualBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(actualBuffer, expectedBuffer);

    if (!validSignature) {

        throw new Error(
            "Invalid token signature."
        );

    }

    const payload =
        JSON.parse(
            Buffer.from(encodedPayload, "base64url").toString("utf8")
        );

    if (
        payload.exp &&
        payload.exp < Math.floor(Date.now() / 1000)
    ) {

        throw new Error(
            "Token expired."
        );

    }

    if (!payload.uid) {

        throw new Error(
            "Token payload is missing uid."
        );

    }

    return payload;

}


module.exports = { verifyBackendJwt };
