import { NextFunction, Request, Response } from 'express'

import { verifyAuthorization } from '../services/authService'

/** Requires `Authorization: Basic base64(apiKey:token)`; sets the host mode for controllers. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const { apiKey, mode } = verifyAuthorization(req.get('authorization'))
    res.locals.apiKey = apiKey
    res.locals.hostMode = mode
    next()
  } catch (err) {
    next(err)
  }
}
