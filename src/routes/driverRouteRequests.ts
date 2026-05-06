import { Request, Response, Router } from 'express'

import * as store from '../store'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

// GET /api/driver/route-requests?driverId= — driver inbox
router.get(
  '/route-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const { driverId } = req.query
    requireParam(driverId as string, 'driverId query is required')

    res.json(await store.listRouteRequestsByDriver(driverId as string))
  }),
)

// POST /api/driver/route-requests/:id/accept
router.post(
  '/route-requests/:id/accept',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await store.acceptRouteRequest(req.params.id as string)
    res.json(result)
  }),
)

// POST /api/driver/route-requests/:id/decline
router.post(
  '/route-requests/:id/decline',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await store.declineRouteRequest(req.params.id as string)
    res.json(result)
  }),
)

export default router
