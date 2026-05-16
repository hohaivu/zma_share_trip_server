import { NextFunction, Request, RequestHandler, Response } from 'express'
import type { ZodType } from 'zod'

/**
 * Factory that returns middleware requiring specific body fields.
 * Legacy presence-only check kept for the Zalo proxy routes.
 * Usage: validate('accessToken', 'code')
 */
export default function validate(...requiredFields: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const field of requiredFields) {
      if (!req.body[field]) {
        res
          .status(400)
          .json({ error: -1, message: `Missing required field: ${field}` })
        return
      }
    }
    next()
  }
}

export type ValidateSource = 'body' | 'query' | 'params'

/**
 * Schema-driven validation boundary. Parses `req[source]` with the provided
 * zod schema before the controller runs. On failure responds 400 with the
 * shared error envelope (see API.md → "Validation Errors").
 *
 * On success the parsed (and possibly transformed/coerced) data replaces
 * `req[source]`, so downstream handlers get the narrowed payload.
 */
export function validateSchema(
  source: ValidateSource,
  schema: ZodType,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          issues: result.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
            code: issue.code,
          })),
        },
      })
      return
    }
    // Express 5 query/params getters are read-only; assign through `any`.
    ;(req as unknown as Record<ValidateSource, unknown>)[source] = result.data
    next()
  }
}
