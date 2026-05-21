import { Router } from 'express'

import { journeysController } from '../controllers/journeysController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/journeys/get-summary
router.post('/journeys/get-summary', asyncHandler(journeysController.getJourneySummary))

// POST /api/trips/cancel
router.post('/trips/cancel', asyncHandler(journeysController.cancelTrip))

// POST /api/trips/complete
router.post('/trips/complete', asyncHandler(journeysController.completeTrip))

// Deprecated: saved locations
router.post('/trips/saved-locations/list', asyncHandler(journeysController.listSavedLocations))

router.post('/trips/saved-locations/create', asyncHandler(journeysController.createSavedLocation))

router.post(
  '/trips/saved-locations/delete',
  asyncHandler(journeysController.deleteSavedLocation),
)

export default router
