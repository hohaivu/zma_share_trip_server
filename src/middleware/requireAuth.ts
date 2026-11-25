import { NextFunction, Request, Response } from 'express'

import { verifyAuthorization } from '../services/authService'

/** Requires `Authorization: Basic base64(apiKey:token)`; sets `res.locals.mode` for controllers. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  res.locals.mode = verifyAuthorization(req.get('authorization'))
  next()
}
