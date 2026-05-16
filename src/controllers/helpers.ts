import { Response } from 'express'

import { HttpError } from '../http-error'
import { errorBody, httpErrorCode } from '../shared/responseEnvelope'

export function requireParam(value: unknown, message: string): asserts value {
  if (!value) {
    throw new HttpError(400, message)
  }
}

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
