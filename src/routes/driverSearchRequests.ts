import { Router, Request, Response } from 'express';
import * as store from '../store';
import { asyncHandler, requireParam } from './helpers';

const router = Router();

// GET /api/driver/search-requests?driverId= — driver inbox
router.get('/search-requests', asyncHandler(async (req: Request, res: Response) => {
  const { driverId } = req.query;
  requireParam(driverId as string, 'driverId query is required');

  res.json(await store.listSearchRequestsByDriver(driverId as string));
}));

// POST /api/driver/search-requests/:id/accept
router.post('/search-requests/:id/accept', asyncHandler(async (req: Request, res: Response) => {
  const result = await store.acceptSearchRequest(req.params.id as string);
  res.json(result);
}));

// POST /api/driver/search-requests/:id/decline
router.post('/search-requests/:id/decline', asyncHandler(async (req: Request, res: Response) => {
  const result = await store.declineSearchRequest(req.params.id as string);
  res.json(result);
}));

export default router;
