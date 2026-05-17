import { HttpError } from '../http-error'

const LOW_BALANCE_MESSAGE =
  'Wallet balance is too low to reserve this route fee. Top up and retry.'
const TOP_UP_RETRY_MESSAGE =
  'Top-up is already being processed. Retry with a different amount after it settles.'

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

export function requireBodyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new HttpError(
      400,
      `Wallet validation error: ${fieldName} is required`,
    )
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new HttpError(
      400,
      `Wallet validation error: ${fieldName} is required`,
    )
  }
  return trimmed
}

export function parsePositiveInteger(
  value: string | undefined,
  fieldName: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new HttpError(
      400,
      `Wallet validation error: ${fieldName} must be a positive integer`,
    )
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(
      400,
      `Wallet validation error: ${fieldName} must be a positive integer`,
    )
  }

  return parsed
}

export function normalizeWalletError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    const message = error.message.toLowerCase()
    if (error.statusCode === 409 && /duplicate|retry|already/i.test(message)) {
      return new HttpError(409, TOP_UP_RETRY_MESSAGE)
    }
    if (message.includes('balance') || message.includes('insufficient')) {
      return new HttpError(400, LOW_BALANCE_MESSAGE)
    }
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  if (lowered.includes('balance') || lowered.includes('insufficient')) {
    return new HttpError(400, LOW_BALANCE_MESSAGE)
  }
  if (lowered.includes('duplicate') || lowered.includes('retry')) {
    return new HttpError(409, TOP_UP_RETRY_MESSAGE)
  }

  return new HttpError(500, 'Internal server error')
}
