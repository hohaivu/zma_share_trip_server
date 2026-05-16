import { Router } from 'express'

import {
  listInboundRouteRequests,
  listMatchedDemandGroups,
} from '../controllers/matchingController'
import { asyncHandler } from './helpers'

const router = Router()

// GET /api/driver/routes/:id/matched-demand-groups
router.get(
  '/routes/:id/matched-demand-groups',
  asyncHandler(listMatchedDemandGroups),
)

// GET /api/driver/routes/:id/inbound-route-requests
router.get(
  '/routes/:id/inbound-route-requests',
  asyncHandler(listInboundRouteRequests),
)

export default router
