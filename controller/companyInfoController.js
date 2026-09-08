const { getCompanyInfo, updateCompanyInfo } = require("../service/companyInfoService");


async function get(req, res) {

    try {

        const companyInfo = await getCompanyInfo();

        return res.status(200).json({ success: true, companyInfo });

    } catch (error) {

        console.error("❌ Get company info controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to retrieve company info.",

        });

    }

}


async function update(req, res) {

    try {

        const companyInfo = await updateCompanyInfo(req.body);

        return res.status(200).json({ success: true, companyInfo });

    } catch (error) {

        console.error("❌ Update company info controller error:", error);

        return res.status(400).json({

            success: false,

            message: error.message || "Unable to update company info.",

        });

    }

}


module.exports = { get, update };
