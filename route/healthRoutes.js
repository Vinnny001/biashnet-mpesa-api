const express = require("express");

/*
Light health check: answers immediately, touches nothing.
Mounted at /health and /api/health in server.js, ahead of
every other route.
*/

const router = express.Router();

router.get("/health", (req, res) => {

    res.json({
        success: true,
        status: "live",
        message: "Server is live",
    });

});

module.exports = router;
