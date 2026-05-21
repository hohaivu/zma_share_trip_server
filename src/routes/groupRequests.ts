import { Router } from 'express'

import { groupRequestsController } from '../controllers/groupRequestsController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/drivers/group-requests/create — create group request + fan-out
router.post(
  '/group-requests/create',
  asyncHandler(groupRequestsController.createGroupRequest),
)

// POST /api/drivers/group-requests/list — driver's sent requests
router.post(
  '/group-requests/list',
  asyncHandler(groupRequestsController.listGroupRequests),
)

// POST /api/drivers/group-requests/cancel — cancel + close pending offers
router.post(
  '/group-requests/cancel',
  asyncHandler(groupRequestsController.cancelGroupRequest),
)

export default router
