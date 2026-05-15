import { Router } from 'express'

import { clientPlansController } from '../controllers/clientPlansController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/client/trip-plans — create a plan
router.post('/trip-plans', asyncHandler(clientPlansController.createPlan))

// GET /api/client/trip-plans?clientId= — list by client
router.get('/trip-plans', asyncHandler(clientPlansController.listPlans))

// GET /api/client/trip-plans/:id — detail
router.get('/trip-plans/:id', asyncHandler(clientPlansController.getPlan))

// PUT /api/client/trip-plans/:id — update
router.put('/trip-plans/:id', asyncHandler(clientPlansController.updatePlan))

// DELETE /api/client/trip-plans/:id — cancel own plan
router.delete('/trip-plans/:id', asyncHandler(clientPlansController.cancelPlan))

export default router
