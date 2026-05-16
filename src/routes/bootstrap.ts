import { Request, Response, Router } from 'express'

import { usersController } from '../controllers/usersController'
import { BootstrapPayload } from '../types/payloads'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/users/bootstrap — resolve or create app user from MAUID
router.post(
  '/users/bootstrap',
  asyncHandler((req: Request<Record<string, never>, unknown, BootstrapPayload>, res: Response) =>
    usersController.bootstrapUser(req, res),
  ),
)

export default router
