import { Router } from 'express'

import { getDemandGroup, listDemandGroupMembers } from '../controllers/demandGroupsController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/drivers/demand-groups/get
router.post('/demand-groups/get', asyncHandler(getDemandGroup))

// POST /api/drivers/demand-groups/members/list
router.post('/demand-groups/members/list', asyncHandler(listDemandGroupMembers))

export default router
