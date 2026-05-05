import { Request, Response, Router } from 'express'

import { HttpError } from '../http-error'
import * as store from '../store'
import { BootstrapPayload } from '../types/payloads'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

// POST /api/users/bootstrap — resolve or create app user from MAUID
router.post(
  '/users/bootstrap',
  asyncHandler(
    async (
      req: Request<Record<string, never>, unknown, BootstrapPayload>,
      res: Response,
    ) => {
      const { mauid, displayName, avatarUrl } = req.body
      requireParam(mauid, 'mauid is required')
      requireParam(displayName, 'displayName is required')
      if (avatarUrl === undefined)
        throw new HttpError(400, 'avatarUrl is required')

      const { session, wasCreated } = await store.bootstrapUser(
        mauid,
        displayName,
        avatarUrl,
      )

      res.status(wasCreated ? 201 : 200).json(session)
    },
  ),
)

export default router
