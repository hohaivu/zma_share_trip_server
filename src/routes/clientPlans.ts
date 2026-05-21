import { Router } from 'express'

import { clientPlansController } from '../controllers/clientPlansController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/clients/trip-plans/create — create a plan
router.post('/trip-plans/create', asyncHandler(clientPlansController.createPlan))

// POST /api/clients/trip-plans/list — list by client
router.post('/trip-plans/list', asyncHandler(clientPlansController.listPlans))

// POST /api/clients/trip-plans/get — detail
router.post('/trip-plans/get', asyncHandler(clientPlansController.getPlan))

// POST /api/clients/trip-plans/update — update
router.post('/trip-plans/update', asyncHandler(clientPlansController.updatePlan))

// POST /api/clients/trip-plans/cancel — cancel own plan
router.post('/trip-plans/cancel', asyncHandler(clientPlansController.cancelPlan))

export default router
