import { Router } from 'express'

import { demandGroupsController } from '../controllers/demandGroupsController'
import { asyncHandler } from './helpers'

const router = Router()

// GET /api/driver/demand-groups/:id — group summary
router.get('/demand-groups/:id', asyncHandler(demandGroupsController.getDemandGroup))

// GET /api/driver/demand-groups/:id/members — member list
router.get(
  '/demand-groups/:id/members',
  asyncHandler(demandGroupsController.getDemandGroupMembers),
)

export default router
