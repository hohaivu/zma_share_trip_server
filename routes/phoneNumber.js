const { Router } = require("express");
const validate = require("../middleware/validate");

const router = Router();

/**
 * POST /api/phone-number
 * Exchanges a phone number token for the actual phone number.
 */
router.post(
  "/phone-number",
  validate("accessToken", "code"),
  async (req, res, next) => {
    try {
      const { accessToken, code } = req.body;
      const secretKey = process.env.ZALO_APP_SECRET;

      const url = `https://graph.zalo.me/v2.0/me/info?access_token=${encodeURIComponent(accessToken)}&code=${encodeURIComponent(code)}&secret_key=${encodeURIComponent(secretKey)}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error && data.error !== 0) {
        return res.status(400).json({
          error: -1,
          message: data.message || "Token expired or invalid",
        });
      }

      res.json({ error: 0, message: "Success", data: data.data });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
