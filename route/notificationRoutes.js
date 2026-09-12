const express = require("express");

const router = express.Router();

const {
    list,
    markRead,
    markAllRead,
} = require("../controller/notificationController");

const {
    requireAuth
} = require("../middleware/auth");


/*
=========================================================
NOTIFICATION ROUTES
=========================================================

Base path: /api/notifications

GET   /                            my notifications, newest first
POST  /read-all                    clear the unread badge
PATCH /:notificationId/read        mark one read

Any authenticated user — buyer, seller or employee. The
notification's owner is taken from the token, so these
need no role gate: you can only ever see your own.

/read-all is declared BEFORE /:notificationId/read so the
literal path is not swallowed by the parameter.
=========================================================
*/

router.get(
    "/",
    requireAuth,
    list
);

router.post(
    "/read-all",
    requireAuth,
    markAllRead
);

router.patch(
    "/:notificationId/read",
    requireAuth,
    markRead
);


module.exports = router;
