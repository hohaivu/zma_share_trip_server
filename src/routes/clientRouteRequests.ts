import { Request, Response, Router } from 'express'

import * as store from '../store'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

// POST /api/client/route-requests — create route request
router.post(
  '/route-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const { clientId, planId, routeId, note } = req.body || {}
    requireParam(clientId, 'clientId is required')
    requireParam(planId, 'planId is required')
    requireParam(routeId, 'routeId is required')

    const result = await store.createRouteRequest(
      clientId,
      planId,
      routeId,
      note,
    )
    res.status(201).json(result)
  }),
)

const listRouteRequestsByClientHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { clientId } = req.query
    requireParam(clientId as string, 'clientId query is required')

    res.json(await store.listRouteRequestsByClient(clientId as string))
  },
)

// GET /api/client/outgoing-route-requests?clientId= — client's sent requests
router.get('/outgoing-route-requests', listRouteRequestsByClientHandler)

// POST /api/client/route-requests/:id/cancel
router.post(
  '/route-requests/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await store.cancelRouteRequest(req.params.id as string)
    res.json(result)
  }),
)

export default router
