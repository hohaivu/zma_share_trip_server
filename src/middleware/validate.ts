import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Factory that returns middleware requiring specific body fields.
 * Usage: validate('accessToken', 'code')
 */
export default function validate(...requiredFields: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const field of requiredFields) {
      if (!req.body[field]) {
        res
          .status(400)
          .json({ error: -1, message: `Missing required field: ${field}` });
        return;
      }
    }
    next();
  };
}
