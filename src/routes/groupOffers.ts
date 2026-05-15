import { Router } from 'express'

import { groupOffersController } from '../controllers/groupOffersController'
import { asyncHandler } from './helpers'

const router = Router()

// GET /api/client/incoming-driver-offers?clientId= — client inbox
router.get('/incoming-driver-offers', asyncHandler(groupOffersController.listGroupOffers))

// POST /api/client/group-offers/:id/accept
router.post('/group-offers/:id/accept', asyncHandler(groupOffersController.acceptGroupOffer))

// POST /api/client/group-offers/:id/decline
router.post('/group-offers/:id/decline', asyncHandler(groupOffersController.declineGroupOffer))

export default router
