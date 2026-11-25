import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import { HttpError } from '../src/http-error'
import { issueToken, verifyAuthorization } from '../src/services/authService'
import { TEST_AUTH_ENV } from './authSupport'

const header = (apiKey: string, token: string) =>
  `Basic ${Buffer.from(`${apiKey}:${token}`).toString('base64')}`

const is401 = (err: unknown) => err instanceof HttpError && err.statusCode === 401

afterEach(() => mock.restoreAll())

describe('authService', () => {
  it('round-trips each configured host to its mode', () => {
    for (const [mode, key, secret] of [
      ['client', 'test-client-key', 'test-client-secret'],
      ['driver', 'test-driver-key', 'test-driver-secret'],
    ] as const) {
      assert.equal(verifyAuthorization(header(key, issueToken(key, secret))), mode)
    }
  })

  it('rejects wrong secret, unknown key, and empty credentials', () => {
    assert.throws(() => issueToken('test-client-key', 'nope'), is401)
    assert.throws(() => issueToken('test-client-key', 'test-client-secre'), is401)
    assert.throws(() => issueToken('unknown', 'test-client-secret'), is401)
    assert.throws(() => issueToken('test-client-key', 'test-driver-secret'), is401)
    assert.throws(() => issueToken('', ''), is401)
  })

  it('rejects keys containing a colon, which the Basic header cannot carry', () => {
    try {
      process.env.CLIENT_API_KEY = 'team:client'
      assert.throws(() => issueToken('team:client', 'test-client-secret'), is401)
      assert.equal(verifyAuthorization(header('test-driver-key', issueToken('test-driver-key', 'test-driver-secret'))), 'driver')
    } finally {
      Object.assign(process.env, TEST_AUTH_ENV)
    }
  })

  it('rejects a key shared by both modes instead of picking one', () => {
    try {
      process.env.DRIVER_API_KEY = 'test-client-key'
      assert.throws(() => issueToken('test-client-key', 'test-client-secret'), is401)
      assert.throws(() => issueToken('test-client-key', 'test-driver-secret'), is401)
    } finally {
      Object.assign(process.env, TEST_AUTH_ENV)
    }
  })

  it('treats unset or empty env as unauthenticatable', () => {
    const saved = { ...process.env }
    try {
      process.env.CLIENT_API_KEY = ''
      process.env.CLIENT_API_SECRET = ''
      assert.throws(() => issueToken('', ''), is401)
      process.env.CLIENT_API_KEY = saved.CLIENT_API_KEY
      process.env.CLIENT_API_SECRET = saved.CLIENT_API_SECRET
      const token = issueToken('test-client-key', 'test-client-secret')
      delete process.env.AUTH_TOKEN_SECRET
      assert.throws(() => issueToken('test-client-key', 'test-client-secret'), is401)
      assert.throws(() => verifyAuthorization(header('test-client-key', token)), is401)
    } finally {
      Object.assign(process.env, TEST_AUTH_ENV)
    }
  })

  it('rejects missing, malformed, and tampered headers with 401 (never 500)', () => {
    const token = issueToken('test-client-key', 'test-client-secret')
    const [exp, signature] = token.split('.')
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
    const bad: Array<string | undefined> = [
      undefined,
      '',
      'Bearer abc',
      'Basic',
      'Basic !!!',
      `Basic ${Buffer.from('nocolon').toString('base64')}`,
      `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
      header('test-client-key', 'garbage'),
      header('test-client-key', `${exp}.`),
      header('test-client-key', `${exp}.${signature}.extra`),
      header('test-client-key', `${Number(exp) + 1}.${signature}`),
      header('test-client-key', `${exp}.${flip(signature, 3)}`),
    ]
    for (const value of bad) assert.throws(() => verifyAuthorization(value), is401, String(value))
  })

  it('rejects a token used with another configured apiKey', () => {
    const token = issueToken('test-client-key', 'test-client-secret')
    assert.throws(() => verifyAuthorization(header('test-driver-key', token)), is401)
  })

  it('rejects an expired token', () => {
    const now = Date.now()
    const token = issueToken('test-client-key', 'test-client-secret')
    mock.method(Date, 'now', () => now + 24 * 60 * 60 * 1000 + 1)
    assert.throws(() => verifyAuthorization(header('test-client-key', token)), is401)
  })

  it('rejects a token whose key is no longer configured', () => {
    const token = issueToken('test-client-key', 'test-client-secret')
    process.env.CLIENT_API_KEY = 'rotated-key'
    try {
      assert.throws(() => verifyAuthorization(header('test-client-key', token)), is401)
    } finally {
      Object.assign(process.env, TEST_AUTH_ENV)
    }
  })
})
