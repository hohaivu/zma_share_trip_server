import { Request, Response, Router } from 'express'

import * as store from '../store'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

const listGroupOffersHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { clientId } = req.query
    requireParam(clientId as string, 'clientId query is required')

    res.json(await store.listGroupOffersByClient(clientId as string))
  },
)

// GET /api/client/incoming-driver-offers?clientId= — client inbox
router.get('/incoming-driver-offers', listGroupOffersHandler)

// POST /api/client/group-offers/:id/accept
router.post(
  '/group-offers/:id/accept',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await store.acceptGroupOffer(req.params.id as string)
    res.json(result)
  }),
)

// POST /api/client/group-offers/:id/decline
router.post(
  '/group-offers/:id/decline',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await store.declineGroupOffer(req.params.id as string)
    res.json(result)
  }),
)

export default router
