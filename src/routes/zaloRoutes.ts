import { Router } from 'express'

import validate from '../middleware/validate'
import { proxyProfile, proxySecretExchange } from './zaloProxy'

const router = Router()

// POST /api/authorize — validate a Zalo access token
router.post('/authorize', validate('accessToken'), proxyProfile)

// POST /api/user-info — retrieve user profile via Zalo access token
router.post('/user-info', validate('accessToken'), proxyProfile)

// POST /api/phone-number — exchange phone number token for actual number
router.post(
  '/phone-number',
  validate('accessToken', 'code'),
  proxySecretExchange,
)

// POST /api/location — exchange location token for GPS coordinates
router.post('/location', validate('accessToken', 'code'), proxySecretExchange)

export default router
