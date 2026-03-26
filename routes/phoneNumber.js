const { Router } = require('express')
const validate = require('../middleware/validate')
const { proxySecretExchange } = require('./zaloProxy')

const router = Router()

// POST /api/phone-number — exchange phone number token for actual number
router.post(
  '/phone-number',
  validate('accessToken', 'code'),
  proxySecretExchange,
)

module.exports = router
