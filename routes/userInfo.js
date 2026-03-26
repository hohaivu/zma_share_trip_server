const { Router } = require('express')
const validate = require('../middleware/validate')
const { proxyProfile } = require('./zaloProxy')

const router = Router()

// POST /api/user-info — retrieve user profile via Zalo access token
router.post('/user-info', validate('accessToken'), proxyProfile)

module.exports = router
