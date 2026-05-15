import { Router } from 'express'

import { groupRequestsController } from '../controllers/groupRequestsController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/driver/group-requests — create group request + fan-out
router.post(
  '/group-requests',
  asyncHandler(groupRequestsController.createGroupRequest),
)

// GET /api/driver/group-requests?driverId= — driver's sent requests
router.get(
  '/group-requests',
  asyncHandler(groupRequestsController.listGroupRequests),
)

// POST /api/driver/group-requests/:id/cancel — cancel + close pending offers
router.post(
  '/group-requests/:id/cancel',
  asyncHandler(groupRequestsController.cancelGroupRequest),
)

export default router
