import { Router } from 'express'

import { searchRoutes } from '../controllers/matchingController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/client/route-suggestions
router.post('/route-suggestions', asyncHandler(searchRoutes))

export default router
