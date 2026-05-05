import { Request, Response, Router } from 'express'

import * as matching from '../matching'
import * as store from '../store'
import { asyncHandler } from './helpers'

const router = Router()
const ACTIONABLE_SEARCH_REQUEST_STATUS = 'pending'

// GET /api/driver/routes/:id/matched-demand-groups
router.get(
  '/routes/:id/matched-demand-groups',
  asyncHandler(async (req: Request, res: Response) => {
    const route = await store.getRoute(req.params.id as string)
    if (!route) {
      return res.status(404).json({ message: 'Route not found' })
    }

    const results = await matching.computeMatchedDemandGroups(
      req.params.id as string,
    )
    res.json(results)
  }),
)

// GET /api/driver/routes/:id/inbound-route-requests
router.get(
  '/routes/:id/inbound-route-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const route = await store.getRoute(req.params.id as string)
    if (!route) {
      return res.status(404).json({ message: 'Route not found' })
    }

    const results = await store.listRouteRequestsByRoute(
      req.params.id as string,
    )
    res.json(
      results.filter(
        (request) => request.status === ACTIONABLE_SEARCH_REQUEST_STATUS,
      ),
    )
  }),
)

export default router
