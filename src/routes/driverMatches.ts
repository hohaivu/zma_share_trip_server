import { Router } from 'express'

import {
  getDemandGroup,
  listDemandGroupMembers,
  listInboundRouteRequests,
  listMatchedDemandGroups,
} from '../controllers/matchingController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/drivers/routes/matched-demand-groups/list
router.post(
  '/routes/matched-demand-groups/list',
  asyncHandler(listMatchedDemandGroups),
)

// POST /api/drivers/routes/inbound-search-requests/list
router.post(
  '/routes/inbound-search-requests/list',
  asyncHandler(listInboundRouteRequests),
)

// POST /api/drivers/demand-groups/get
router.post('/demand-groups/get', asyncHandler(getDemandGroup))

// POST /api/drivers/demand-groups/members/list
router.post('/demand-groups/members/list', asyncHandler(listDemandGroupMembers))

export default router
