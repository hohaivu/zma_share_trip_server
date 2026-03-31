import { Router, Request, Response } from 'express';
import * as store from '../store';
import { asyncHandler } from './helpers';

const router = Router();

// GET /api/driver/demand-groups/:id — group summary
router.get('/demand-groups/:id', asyncHandler(async (req: Request, res: Response) => {
  const group = await store.getDemandGroup(req.params.id as string);
  if (!group) {
    return res.status(404).json({ message: 'Demand group not found' });
  }

  res.json(group);
}));

// GET /api/driver/demand-groups/:id/members — member list
router.get('/demand-groups/:id/members', asyncHandler(async (req: Request, res: Response) => {
  const members = await store.getDemandGroupMembers(req.params.id as string);
  if (!members) {
    return res.status(404).json({ message: 'Demand group not found' });
  }
  res.json(members);
}));

export default router;
