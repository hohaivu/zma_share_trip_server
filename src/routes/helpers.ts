import { NextFunction, Request, RequestHandler, Response } from 'express'

import { HttpError } from '../http-error'
import { errorBody, httpErrorCode } from '../shared/responseEnvelope'

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
      const status = err instanceof HttpError ? err.statusCode : 500
      const message =
        status === 500
          ? 'Internal server error'
          : err instanceof Error
            ? err.message
            : 'Internal server error'
      const payload = err instanceof HttpError ? err.payload : undefined
      if (status === 500) console.error('[server error]', err)
      res
        .status(status)
        .json(errorBody(httpErrorCode(status), message, { details: payload }))
    })
  }
}

export function requireParam(value: unknown, message: string): asserts value {
  if (!value) {
    throw new HttpError(400, message)
  }
}
