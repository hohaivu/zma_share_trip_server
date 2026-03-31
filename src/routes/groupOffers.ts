import { Router, Request, Response } from 'express';
import * as store from '../store';
import { asyncHandler, requireParam } from './helpers';

const router = Router();

// GET /api/client/group-offers?clientId= — client inbox
router.get('/group-offers', asyncHandler(async (req: Request, res: Response) => {
  const { clientId } = req.query;
  requireParam(clientId as string, 'clientId query is required');

  res.json(await store.listGroupOffersByClient(clientId as string));
}));

// POST /api/client/group-offers/:id/accept
router.post('/group-offers/:id/accept', asyncHandler(async (req: Request, res: Response) => {
  const result = await store.acceptGroupOffer(req.params.id as string);
  res.json(result);
}));

// POST /api/client/group-offers/:id/decline
router.post('/group-offers/:id/decline', asyncHandler(async (req: Request, res: Response) => {
  const result = await store.declineGroupOffer(req.params.id as string);
  res.json(result);
}));

export default router;
