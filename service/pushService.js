const {
  admin,
  db,
  FieldValue,
} = require("../config/firebase");

/*
 * Must match front/src/services/push.js's NOTIFICATION_CHANNEL_ID
 * exactly — Android routes an incoming push through whichever channel
 * ID is on the message. If this doesn't match a channel the app has
 * actually created on the device (or the device never created any
 * channel because google-services.json was missing/empty), Android
 * falls back to a default channel at IMPORTANCE_DEFAULT, which never
 * shows a heads-up banner regardless of what's sent here.
 */
const ANDROID_NOTIFICATION_CHANNEL_ID = "biashnet_default";


/*
=========================================================
PUSH SERVICE (Android — Capacitor push-notifications / FCM)
=========================================================

Sends a real device push alongside an in-app notification
record. userId's device tokens live on users/{uid}.fcmTokens
(an array — a user can have more than one device),
registered via backend's POST /api/users/me/device-token —
same Firestore project, so this reads it directly.

Never throws — a missing google-services.json on the
Android build, a user with no registered device, or an
FCM API failure must never break the notification/business
flow that triggered it. Callers should still wrap calls in
their own .catch(() => {}) for defense in depth.
=========================================================
*/

async function sendPush(userId, { title, message }) {

  if (!userId || !title || !message) {

    return;

  }

  try {

    const userSnap =
      await db
        .collection("users")
        .doc(userId)
        .get();

    const tokens =
      userSnap.exists
        ? (userSnap.data().fcmTokens || [])
        : [];

    if (
      !Array.isArray(tokens) ||
      tokens.length === 0
    ) {

      return;

    }

    /*
    -------------------------------------------------------
    ONE send() PER DEVICE — NOT A MULTICAST
    -------------------------------------------------------

    This service runs firebase-admin 10.3.0. The previous
    code called sendEachForMulticast(), which only exists
    from 11.7.0, so every push ever attempted threw
    "is not a function" into the catch below and no device
    ever received one. In-app notifications were unaffected,
    which is why this went unnoticed.

    The v10 multicast methods (sendMulticast / sendAll) are
    not a fix either: they go through FCM's legacy batch
    endpoint, which Google shut down in June 2024. send()
    uses the current HTTP v1 API and works on this version
    — it is also what sendEachForMulticast does internally,
    one request per token.

    Upgrading firebase-admin would allow the multicast call
    again, but it is a major-version jump across a service
    that moves money; not worth that risk for a push.
    -------------------------------------------------------
    */

    const message_ = {

      notification: {

        title,

        body: message,

      },

      /*
      High message priority tells FCM to wake the device and
      deliver immediately (vs "normal", which Android/FCM may
      batch and delay); channelId is what actually produces
      the heads-up banner on the device, driven by that
      channel's own IMPORTANCE_HIGH set at creation time.
      */
      android: {

        priority: "high",

        notification: {

          channelId:
            ANDROID_NOTIFICATION_CHANNEL_ID,

        },

      },

    };

    const results =
      await Promise.allSettled(
        tokens.map(
          (token) =>
            admin.messaging().send({

              ...message_,

              token,

            })
        )
      );

    /*
    -------------------------------------------------------
    PRUNE DEAD TOKENS, LOG EVERYTHING ELSE
    -------------------------------------------------------

    A token stops being valid when the app is uninstalled or
    reinstalled, the user revokes notification permission
    at the OS level, etc. — clean those up so future sends
    don't keep paying the round-trip for a device that's
    gone.

    Any OTHER failure is logged. The old code silently
    dropped every non-dead-token error, which is exactly how
    a broken push path stayed invisible.
    -------------------------------------------------------
    */

    const deadTokens = [];

    results.forEach(
      (result, index) => {

        if (result.status === "fulfilled") {

          return;

        }

        const code =
          result.reason?.code;

        if (
          code === "messaging/invalid-registration-token" ||
          code === "messaging/registration-token-not-registered"
        ) {

          deadTokens.push(
            tokens[index]
          );

          return;

        }

        console.error(
          "❌ Push rejected by FCM:",
          userId,
          code || "",
          result.reason?.message
        );

      }
    );

    if (deadTokens.length > 0) {

      await db
        .collection("users")
        .doc(userId)
        .update({

          fcmTokens:
            FieldValue.arrayRemove(
              ...deadTokens
            ),

        })
        .catch(
          () => {}
        );

    }

  } catch (error) {

    console.error(
      "❌ Push notification send failed:",
      userId,
      error.message
    );

  }

}


module.exports = {

  sendPush,

};
