import { Router, Request, Response } from 'express';
import * as matching from '../matching';
import { asyncHandler, requireParam } from './helpers';
import { SearchRoutesCriteriaPayload } from '../types/payloads';

const router = Router();

// POST /api/client/search-routes
router.post('/search-routes', asyncHandler(async (
  req: Request<Record<string, never>, unknown, SearchRoutesCriteriaPayload>,
  res: Response
) => {
  const criteria = req.body;
  requireParam(criteria.clientId, 'clientId is required');
  requireParam(criteria.pickup, 'pickup is required');
  requireParam(criteria.dropoff, 'dropoff is required');
  requireParam(criteria.serviceDate, 'serviceDate is required');
  requireParam(criteria.departureBlockStart, 'departureBlockStart is required');
  requireParam(criteria.departureBlockEnd, 'departureBlockEnd is required');

  const results = await matching.computeMatchingRoutesFromCriteria(criteria);
  res.json(results);
}));

export default router;
