import { Router } from 'express'

import { groupOffersController } from '../controllers/groupOffersController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/clients/group-offers/list — client inbox
router.post('/group-offers/list', asyncHandler(groupOffersController.listGroupOffers))

// POST /api/clients/group-offers/accept
router.post('/group-offers/accept', asyncHandler(groupOffersController.acceptGroupOffer))

// POST /api/clients/group-offers/decline
router.post('/group-offers/decline', asyncHandler(groupOffersController.declineGroupOffer))

export default router
