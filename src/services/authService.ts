import crypto from 'node:crypto'

import { HttpError } from '../http-error'
import type { UserMode } from '../types/entities'

// shortcut: fixed 24h stateless HMAC token, no revocation; upgrade to a token store if revocation is needed
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

interface Host {
  apiKey: string
  apiSecret: string
  mode: UserMode
}

// Read env at call time. A host with an empty key/secret, or any host when
// AUTH_TOKEN_SECRET is unset, cannot authenticate.
function configuredHosts(): Host[] {
  if (!process.env.AUTH_TOKEN_SECRET) return []
  const hosts: Array<[UserMode, string | undefined, string | undefined]> = [
    ['client', process.env.CLIENT_API_KEY, process.env.CLIENT_API_SECRET],
    ['driver', process.env.DRIVER_API_KEY, process.env.DRIVER_API_SECRET],
  ]
  return hosts.flatMap(([mode, apiKey, apiSecret]) =>
    apiKey && apiSecret ? [{ apiKey, apiSecret, mode }] : [],
  )
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

// Binds the expiry to the API key, so a token only works with the key it was issued to.
function sign(apiKey: string, exp: string): string {
  return crypto
    .createHmac('sha256', process.env.AUTH_TOKEN_SECRET as string)
    .update(`${apiKey}:${exp}`)
    .digest('base64url')
}

/** Returns `exp.signature` for a configured host's key/secret; throws HttpError(401) otherwise. */
export function issueToken(apiKey: string, apiSecret: string): string {
  const host = configuredHosts().find(
    (h) => safeEqual(h.apiKey, apiKey) && safeEqual(h.apiSecret, apiSecret),
  )
  if (!host) throw new HttpError(401, 'Invalid or missing credentials')
  const exp = String(Date.now() + TOKEN_TTL_MS)
  return `${exp}.${sign(host.apiKey, exp)}`
}

/** Verifies `Authorization: Basic base64(apiKey:token)` and returns the key's mode; throws HttpError(401) otherwise. */
export function verifyAuthorization(header: string | undefined): UserMode {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? '')
  const decoded = match ? Buffer.from(match[1], 'base64').toString('utf8') : ''
  const colon = decoded.indexOf(':')
  const apiKey = decoded.slice(0, colon)
  const [exp, signature, ...rest] = decoded.slice(colon + 1).split('.')
  const host = configuredHosts().find((h) => h.apiKey === apiKey)
  if (
    !host ||
    !exp ||
    !signature ||
    rest.length ||
    !safeEqual(sign(apiKey, exp), signature) ||
    !(Number(exp) > Date.now())
  ) {
    throw new HttpError(401, 'Invalid or missing credentials')
  }
  return host.mode
}
