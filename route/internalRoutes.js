const express = require("express");

const router = express.Router();

const { requireInternalSecret } = require("../middleware/internalAuth");

const { runComplianceSweep } = require("../service/complianceSweepService");


/*
=========================================================
INTERNAL ROUTES
=========================================================

Base path: /api/internal

Called by an external scheduler, not a logged-in user.

POST /compliance-sweep

Finds sub-orders that missed their 36h drop-off window,
marks them NON_COMPLIANT, notifies the seller, and flags
the parent order for a buyer decision.

Set up an external cron trigger to call this every
~15-30 minutes, e.g. a Render Cron Job running:

  curl -X POST https://<your-domain>/api/internal/compliance-sweep \
    -H "Authorization: Bearer $INTERNAL_SWEEP_SECRET"

(or any external scheduler like cron-job.org pointed at
the same URL/header).
=========================================================
*/

router.post(
    "/compliance-sweep",
    requireInternalSecret,
    async (req, res) => {

        try {

            const result =
                await runComplianceSweep();

            return res.status(200).json({

                success: true,

                ...result,

            });

        } catch (error) {

            console.error(
                "❌ Compliance sweep route error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Compliance sweep failed.",

            });

        }

    }
);


module.exports = router;
