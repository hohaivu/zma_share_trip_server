import { Router, Request, Response } from 'express';
import * as store from '../store';
import { asyncHandler, requireParam } from './helpers';
import { BootstrapPayload } from '../types/payloads';

const router = Router();

// POST /api/users/bootstrap — resolve or create app user from MAUID
router.post('/users/bootstrap', asyncHandler(async (
  req: Request<Record<string, never>, unknown, BootstrapPayload>,
  res: Response
) => {
  const { mauid, displayName, avatarUrl } = req.body;
  requireParam(mauid, 'mauid is required');
  requireParam(displayName, 'displayName is required');
  if (avatarUrl === undefined) requireParam(null, 'avatarUrl is required');

  const { user, wasCreated } = await store.bootstrapUser(
    mauid,
    displayName,
    avatarUrl
  );

  res.status(wasCreated ? 201 : 200).json(user);
}));

export default router;
