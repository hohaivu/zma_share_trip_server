import { Request, Response, Router } from 'express'

import * as matching from '../matching'
import { SearchRoutesCriteriaPayload } from '../types/payloads'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

const searchRoutesHandler = asyncHandler(
  async (
    req: Request<Record<string, never>, unknown, SearchRoutesCriteriaPayload>,
    res: Response,
  ) => {
    const criteria = req.body
    requireParam(criteria.clientId, 'clientId is required')
    requireParam(criteria.pickup, 'pickup is required')
    requireParam(criteria.dropoff, 'dropoff is required')
    requireParam(criteria.serviceDate, 'serviceDate is required')
    requireParam(criteria.departureBlockStart, 'departureBlockStart is required')
    requireParam(criteria.departureBlockEnd, 'departureBlockEnd is required')

    const results = await matching.computeMatchingRoutesFromCriteria(criteria)
    res.json(results)
  },
)

// POST /api/client/route-suggestions
router.post('/route-suggestions', searchRoutesHandler)

export default router
