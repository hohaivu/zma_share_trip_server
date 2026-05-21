import { Router } from 'express'

import { searchRoutes } from '../controllers/matchingController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/clients/search-routes/list
router.post('/search-routes/list', asyncHandler(searchRoutes))

export default router
