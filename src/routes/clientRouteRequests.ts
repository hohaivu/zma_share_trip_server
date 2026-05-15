import { Router } from 'express'

import {
  cancelRouteRequest,
  createRouteRequest,
  listRouteRequestsByClient,
} from '../controllers/routeRequestsController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/client/route-requests — create route request
router.post('/route-requests', asyncHandler(createRouteRequest))

// GET /api/client/outgoing-route-requests?clientId= — client's sent requests
router.get('/outgoing-route-requests', asyncHandler(listRouteRequestsByClient))

// POST /api/client/route-requests/:id/cancel
router.post('/route-requests/:id/cancel', asyncHandler(cancelRouteRequest))

export default router
