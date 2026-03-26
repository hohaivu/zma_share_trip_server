const { Router } = require('express')
const validate = require('../middleware/validate')
const { proxyProfile } = require('./zaloProxy')

const router = Router()

// POST /api/authorize — validate a Zalo access token
router.post('/authorize', validate('accessToken'), proxyProfile)

module.exports = router
