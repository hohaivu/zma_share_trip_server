import { Router } from 'express'

import {
  acceptRouteRequest,
  declineRouteRequest,
  listRouteRequestsByDriver,
} from '../controllers/routeRequestsController'
import { asyncHandler } from './helpers'

const router = Router()

// GET /api/driver/route-requests?driverId= — driver inbox
router.get('/route-requests', asyncHandler(listRouteRequestsByDriver))

// POST /api/driver/route-requests/:id/accept
router.post('/route-requests/:id/accept', asyncHandler(acceptRouteRequest))

// POST /api/driver/route-requests/:id/decline
router.post('/route-requests/:id/decline', asyncHandler(declineRouteRequest))

export default router
