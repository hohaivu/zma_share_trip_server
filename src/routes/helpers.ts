import { NextFunction, Request, RequestHandler, Response } from 'express'

import { requireParam } from '../shared/requestHelpers'
import { buildErrorResponse } from '../shared/responseEnvelope'

export { requireParam }

export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // `new Promise` (rather than `Promise.resolve(fn(...))`) ensures that even
    // synchronous throws inside `fn` are funneled into `.catch`.
    new Promise<unknown>((resolve) => {
      resolve(fn(req as Req, res as Res, next))
    }).catch((err: unknown) => {
      const { status, body } = buildErrorResponse(err)
      if (status === 500) console.error('[server error]', err)
      res.status(status).json(body)
    })
  }
}
