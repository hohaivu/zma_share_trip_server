import crypto from 'node:crypto'

import { HttpError } from '../http-error'
import type { HostMode } from '../types/entities'

// shortcut: fixed 24h stateless HMAC token, no revocation; upgrade to a token store if revocation is needed
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

interface Host {
  apiKey: string
  apiSecret: string
  mode: HostMode
}

// Read env at call time. A host with an empty key/secret, or any host when
// AUTH_TOKEN_SECRET is unset, cannot authenticate.
function configuredHosts(): Host[] {
  if (!process.env.AUTH_TOKEN_SECRET) return []
  const hosts: Array<[HostMode, string | undefined, string | undefined]> = [
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

function sign(payload: string): string {
  return crypto
    .createHmac('sha256', process.env.AUTH_TOKEN_SECRET as string)
    .update(payload)
    .digest('base64url')
}

const unauthorized = () => new HttpError(401, 'Invalid or missing credentials')

export function issueToken(apiKey: string, apiSecret: string): { token: string; mode: HostMode } {
  const host = configuredHosts().find(
    (h) => safeEqual(h.apiKey, apiKey) && safeEqual(h.apiSecret, apiSecret),
  )
  if (!host) throw unauthorized()
  const payload = Buffer.from(
    JSON.stringify({ k: host.apiKey, m: host.mode, exp: Date.now() + TOKEN_TTL_MS }),
  ).toString('base64url')
  return { token: `${payload}.${sign(payload)}`, mode: host.mode }
}

/** Verifies `Authorization: Basic base64(apiKey:token)`; throws HttpError(401) otherwise. */
export function verifyAuthorization(header: string | undefined): { apiKey: string; mode: HostMode } {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? '')
  if (!match || !process.env.AUTH_TOKEN_SECRET) throw unauthorized()
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  const apiKey = decoded.slice(0, colon)
  const [payload, signature, ...rest] = decoded.slice(colon + 1).split('.')
  if (colon < 1 || !payload || !signature || rest.length || !safeEqual(sign(payload), signature)) {
    throw unauthorized()
  }
  // Signature is valid, so the payload is one we issued.
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    k: string
    m: HostMode
    exp: number
  }
  const stillConfigured = configuredHosts().some((h) => h.apiKey === claims.k && h.mode === claims.m)
  if (claims.exp <= Date.now() || claims.k !== apiKey || !stillConfigured) throw unauthorized()
  return { apiKey, mode: claims.m }
}
