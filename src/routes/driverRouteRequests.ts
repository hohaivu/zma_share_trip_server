import { Router } from 'express'

import {
  acceptRouteRequest,
  declineRouteRequest,
  listRouteRequestsByDriver,
} from '../controllers/routeRequestsController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/drivers/search-requests/list — driver inbox
router.post('/search-requests/list', asyncHandler(listRouteRequestsByDriver))

// POST /api/drivers/search-requests/accept
router.post('/search-requests/accept', asyncHandler(acceptRouteRequest))

// POST /api/drivers/search-requests/decline
router.post('/search-requests/decline', asyncHandler(declineRouteRequest))

export default router
