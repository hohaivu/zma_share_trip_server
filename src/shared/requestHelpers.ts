import { HttpError } from '../http-error'

export function singleQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

export function requireParam(value: unknown, message: string): asserts value {
  if (!value) {
    throw new HttpError(400, message)
  }
}
