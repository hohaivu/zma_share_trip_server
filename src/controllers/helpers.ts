import { Response } from 'express'

import { requireParam } from '../shared/requestHelpers'
import { errorBody, httpErrorCode } from '../shared/responseEnvelope'

export { requireParam }

export function requireQueryString(value: unknown, message: string): string {
  requireParam(value, message)
  return value as string
}

export function requireBodyOrQueryString(
  bodyValue: unknown,
  queryValue: unknown,
  message: string,
): string {
  const value = bodyValue ?? queryValue
  requireParam(value, message)
  return value as string
}

export function notFound(res: Response, message: string): Response {
  return res.status(404).json(errorBody(httpErrorCode(404), message))
}
