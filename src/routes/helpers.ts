import { Request, Response, NextFunction, RequestHandler } from 'express';
import { HttpError } from '../http-error';

export function asyncHandler<Req extends Request = Request, Res extends Response = Response>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown> | unknown
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.statusCode : 500;
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.status(status).json({ message });
    });
  };
}

export function requireParam(value: unknown, message: string): asserts value {
  if (!value) {
    throw new HttpError(400, message);
  }
}
