import { Router, Request, Response } from 'express';
import * as store from '../store';
import { asyncHandler, requireParam } from './helpers';

const router = Router();

// POST /api/users/:id/mode — save preferred mode
router.post('/users/:id/mode', asyncHandler(async (req: Request, res: Response) => {
  const { preferredMode } = req.body || {};
  requireParam(preferredMode, 'preferredMode is required');

  const result = await store.setUserMode(req.params.id as string, preferredMode);
  if (!result) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.json(result);
}));

// GET /api/users/:id/mode — read preferred mode
router.get('/users/:id/mode', asyncHandler(async (req: Request, res: Response) => {
  const result = await store.getUserMode(req.params.id as string);
  if (!result) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.json(result);
}));

export default router;
