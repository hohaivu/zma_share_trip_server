/**
 * Standard API response envelope (ALI-55).
 *
 * Success responses are wrapped as `{ data: ... }` so clients can rely on a
 * single, predictable shape regardless of resource. Paginated/list responses
 * may additionally carry a `meta` object with a `count` (and future cursors).
 *
 * Error responses follow the shape introduced by the zod validation middleware
 * in ALI-54: `{ error: { code, message, issues?, details? } }`. The code is a
 * stable machine-readable string (`VALIDATION_ERROR`, `HTTP_404`, etc.).
 *
 * See `API.md` → "Response Envelope" for the client-facing contract.
 */

export interface ValidationIssue {
  path: Array<string | number>
  message: string
  code: string
}

export interface SuccessEnvelope<T> {
  data: T
  meta?: SuccessMeta
}

export interface SuccessMeta {
  count?: number
  [key: string]: unknown
}

export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    issues?: ValidationIssue[]
    details?: unknown
  }
}

/** Build a 200-shaped success envelope. */
export function ok<T>(data: T, meta?: SuccessMeta): SuccessEnvelope<T> {
  return meta ? { data, meta } : { data }
}

/**
 * Alias of {@link ok} expressing intent for newly created resources.
 * Status code (`201`) is set by the caller via `res.status(201)`.
 */
export function created<T>(data: T, meta?: SuccessMeta): SuccessEnvelope<T> {
  return ok(data, meta)
}

/**
 * Build an error body. `extras` may contain `issues` (validation) and/or
 * `details` (free-form, e.g. domain context). HTTP status is set separately.
 */
export function errorBody(
  code: string,
  message: string,
  extras?: { issues?: ValidationIssue[]; details?: unknown },
): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = { code, message }
  if (extras?.issues) error.issues = extras.issues
  if (extras?.details !== undefined) error.details = extras.details
  return { error }
}

/**
 * Derive a stable error code from an HTTP status. Used by the global error
 * handler when no explicit code is attached to an HttpError.
 */
export function httpErrorCode(status: number): string {
  return `HTTP_${status}`
}
