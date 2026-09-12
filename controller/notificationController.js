const {
    getUserNotifications,
    markNotificationRead,
    markAllNotificationsRead,
} = require("../service/notificationService");


/*
=========================================================
BIASHNET NOTIFICATION CONTROLLER
=========================================================

The order lifecycle has been writing notifications for
both buyers and sellers all along, but nothing ever
exposed them over HTTP, so the app had no way to read
them back.

userId ALWAYS comes from req.user.uid — never from the
body, query or params. A user may only ever read and
clear their own notifications.
=========================================================
*/


function getUserId(req) {

    const userId =
        req.user?.uid;


    if (!userId) {

        const error =
            new Error(
                "Authentication required."
            );

        error.statusCode = 401;

        throw error;

    }


    return userId;

}


function handleError(
    res,
    error,
    fallback
) {

    console.error(
        "❌ Notification controller error:",
        error
    );


    return res.status(
        error.statusCode || 400
    ).json({

        success: false,

        message:
            error.message || fallback,

    });

}


/*
=========================================================
LIST MY NOTIFICATIONS
=========================================================

GET /api/notifications?limit=50
=========================================================
*/

async function list(req, res) {

    try {

        const userId =
            getUserId(req);


        const notifications =
            await getUserNotifications(
                userId,
                req.query.limit || 50
            );


        const unreadCount =
            notifications.filter(
                (notification) =>
                    notification.read !== true
            ).length;


        return res.json({

            success: true,

            notifications,

            unreadCount,

        });

    } catch (error) {

        return handleError(
            res,
            error,
            "Unable to load notifications."
        );

    }

}


/*
=========================================================
MARK ONE READ
=========================================================

PATCH /api/notifications/:notificationId/read
=========================================================
*/

async function markRead(req, res) {

    try {

        const userId =
            getUserId(req);


        const result =
            await markNotificationRead(
                req.params.notificationId,
                userId
            );


        return res.json({

            success: true,

            ...result,

        });

    } catch (error) {

        return handleError(
            res,
            error,
            "Unable to update that notification."
        );

    }

}


/*
=========================================================
MARK ALL READ
=========================================================

POST /api/notifications/read-all
=========================================================
*/

async function markAllRead(req, res) {

    try {

        const userId =
            getUserId(req);


        const result =
            await markAllNotificationsRead(
                userId
            );


        return res.json({

            success: true,

            ...result,

        });

    } catch (error) {

        return handleError(
            res,
            error,
            "Unable to clear your notifications."
        );

    }

}


module.exports = {

    list,

    markRead,

    markAllRead,

};
