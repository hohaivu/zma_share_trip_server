const { Router } = require('express')
const validate = require('../middleware/validate')

const router = Router()

/**
 * POST /api/user-info
 * Retrieves user profile info using a Zalo access token.
 */
router.post('/user-info', validate('accessToken'), async (req, res, next) => {
  try {
    const { accessToken } = req.body
    const url = `https://graph.zalo.me/v2.0/me?access_token=${encodeURIComponent(accessToken)}&fields=id,name,picture`

    const response = await fetch(url)
    const data = await response.json()

    if (data.error && data.error !== 0) {
      return res
        .status(401)
        .json({ error: -1, message: 'Invalid access token' })
    }

    res.json({ error: 0, message: 'Success', data })
  } catch (err) {
    next(err)
  }
})

module.exports = router
