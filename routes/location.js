const { Router } = require('express')
const validate = require('../middleware/validate')
const { proxySecretExchange } = require('./zaloProxy')

const router = Router()

// POST /api/location — exchange location token for GPS coordinates
router.post('/location', validate('accessToken', 'code'), proxySecretExchange)

module.exports = router
