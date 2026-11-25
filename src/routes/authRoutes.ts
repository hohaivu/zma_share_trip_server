import express, { Router } from 'express'

import { issueToken } from '../controllers/authController'
import { validateSchema } from '../middleware/validate'
import { authBodySchema } from '../schemas/auth'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/auth — exchange host api_key/api_secret for a token
router.post('/auth', express.json(), validateSchema('body', authBodySchema), asyncHandler(issueToken))

export default router
