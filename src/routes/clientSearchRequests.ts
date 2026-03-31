import { Router, Request, Response } from 'express';
import * as store from '../store';
import { asyncHandler, requireParam } from './helpers';

const router = Router();

// POST /api/client/search-requests — create search request
router.post('/search-requests', asyncHandler(async (req: Request, res: Response) => {
  const { clientId, planId, routeId, note } = req.body || {};
  requireParam(clientId, 'clientId is required');
  requireParam(routeId, 'routeId is required');

  const result = await store.createSearchRequest(
    clientId,
    planId,
    routeId,
    note
  );
  res.status(201).json(result);
}));

// GET /api/client/search-requests?clientId= — client's sent requests
router.get('/search-requests', asyncHandler(async (req: Request, res: Response) => {
  const { clientId } = req.query;
  requireParam(clientId as string, 'clientId query is required');

  res.json(await store.listSearchRequestsByClient(clientId as string));
}));

export default router;
