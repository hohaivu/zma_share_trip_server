import { Request, Response, Router } from 'express'

import * as store from '../store'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

// POST /api/client/search-requests — create search request
router.post(
  '/search-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const { clientId, planId, routeId, note } = req.body || {}
    requireParam(clientId, 'clientId is required')
    requireParam(routeId, 'routeId is required')

    const result = await store.createSearchRequest(
      clientId,
      planId,
      routeId,
      note,
    )
    res.status(201).json(result)
  }),
)

// GET /api/client/search-requests?clientId= — client's sent requests
router.get(
  '/search-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const { clientId } = req.query
    requireParam(clientId as string, 'clientId query is required')

    res.json(await store.listSearchRequestsByClient(clientId as string))
  }),
)

// POST /api/client/search-requests/:id/cancel
router.post(
  '/search-requests/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await store.cancelSearchRequest(req.params.id as string)
    res.json(result)
  }),
)

export default router
