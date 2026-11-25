import { issueToken } from '../src/services/authService'

// Test host keys. Env is read lazily by authService, so importing this file is enough.
export const TEST_AUTH_ENV = {
  CLIENT_API_KEY: 'test-client-key',
  CLIENT_API_SECRET: 'test-client-secret',
  DRIVER_API_KEY: 'test-driver-key',
  DRIVER_API_SECRET: 'test-driver-secret',
  AUTH_TOKEN_SECRET: 'test-token-signing-secret',
}
Object.assign(process.env, TEST_AUTH_ENV)

/** Authorization header for a configured host (default: client key). */
export function authHeader(mode: 'client' | 'driver' = 'client'): { Authorization: string } {
  const prefix = mode.toUpperCase()
  const apiKey = process.env[`${prefix}_API_KEY`] as string
  const { token } = issueToken(apiKey, process.env[`${prefix}_API_SECRET`] as string)
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:${token}`).toString('base64')}` }
}
