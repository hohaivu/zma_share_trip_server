import { NextFunction, Request, RequestHandler, Response } from 'express'

import { HttpError } from '../http-error'

export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.statusCode : 500
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      const payload = err instanceof HttpError ? err.payload : undefined
      const responseData: Record<string, unknown> = { message }
      if (payload !== undefined) {
        Object.assign(responseData, payload)
      }
      res.status(status).json(responseData)
    })
  }
}

export function requireParam(value: unknown, message: string): asserts value {
  if (!value) {
    throw new HttpError(400, message)
  }
}
