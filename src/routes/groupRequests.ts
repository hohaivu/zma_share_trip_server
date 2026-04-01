import { Request, Response, Router } from 'express'

import * as store from '../store'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

// POST /api/driver/group-requests — create group request + fan-out
router.post(
  '/group-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const { driverId, routeId, demandGroupId, note } = req.body || {}
    requireParam(driverId, 'driverId is required')
    requireParam(routeId, 'routeId is required')
    requireParam(demandGroupId, 'demandGroupId is required')

    const result = await store.createGroupRequest(
      driverId,
      routeId,
      demandGroupId,
      note,
    )
    res.status(201).json(result)
  }),
)

// GET /api/driver/group-requests?driverId= — driver's sent requests
router.get(
  '/group-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const { driverId } = req.query
    requireParam(driverId as string, 'driverId query is required')

    res.json(await store.listGroupRequestsByDriver(driverId as string))
  }),
)

// POST /api/driver/group-requests/:id/cancel — cancel + close pending offers
router.post(
  '/group-requests/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await store.cancelGroupRequest(req.params.id as string)
    res.json(result)
  }),
)

export default router
