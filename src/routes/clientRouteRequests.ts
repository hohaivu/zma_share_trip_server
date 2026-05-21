import { Router } from 'express'

import {
  cancelRouteRequest,
  createRouteRequest,
  listRouteRequestsByClient,
} from '../controllers/routeRequestsController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/clients/search-requests/create — create route request
router.post('/search-requests/create', asyncHandler(createRouteRequest))

// POST /api/clients/route-requests/list — client's sent requests
router.post('/route-requests/list', asyncHandler(listRouteRequestsByClient))

// POST /api/clients/outgoing-route-requests/list — client's sent requests
router.post('/outgoing-route-requests/list', asyncHandler(listRouteRequestsByClient))

// POST /api/clients/search-requests/cancel
router.post('/search-requests/cancel', asyncHandler(cancelRouteRequest))

export default router
