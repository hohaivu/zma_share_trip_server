import { Router } from 'express'

import { journeysController } from '../controllers/journeysController'
import { asyncHandler } from './helpers'

const router = Router()

// GET /api/journeys/:id/summary
router.get('/journeys/:id/summary', asyncHandler(journeysController.getJourneySummary))

// POST /api/trips/:id/cancel
router.post('/trips/:id/cancel', asyncHandler(journeysController.cancelTrip))

// POST /api/trips/:id/complete
router.post('/trips/:id/complete', asyncHandler(journeysController.completeTrip))

// Deprecated: saved locations
router.get('/trips/saved-locations', asyncHandler(journeysController.listSavedLocations))

router.post('/trips/saved-locations', asyncHandler(journeysController.createSavedLocation))

router.delete(
  '/trips/saved-locations/:id',
  asyncHandler(journeysController.deleteSavedLocation),
)

export default router
