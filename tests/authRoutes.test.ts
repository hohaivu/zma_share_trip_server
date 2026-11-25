import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it, mock } from 'node:test'

import app from '../src/index.js'
import { authHeader } from './authSupport'

let server: http.Server

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: (server.address() as { port: number }).port,
        path,
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => (data += chunk.toString()))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data })
          }
        })
      },
    )
    req.on('error', reject)
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('POST /api/auth', () => {
  it('returns raw { base_url, token } for a configured key pair', async () => {
    const res = await request('POST', '/api/auth', {
      api_key: 'test-driver-key',
      api_secret: 'test-driver-secret',
    })
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body).sort(), ['base_url', 'token'])
    assert.match(res.body.base_url, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.ok(res.body.token)
  })

  it('returns 401 for wrong secret and unknown key', async () => {
    for (const body of [
      { api_key: 'test-driver-key', api_secret: 'wrong' },
      { api_key: 'nobody', api_secret: 'test-driver-secret' },
    ]) {
      const res = await request('POST', '/api/auth', body)
      assert.equal(res.status, 401)
      assert.equal(res.body.error.code, 'HTTP_401')
    }
  })

  it('returns 400 for malformed JSON without echoing or logging the body', async () => {
    const errorLog = mock.method(console, 'error')
    const raw = '{"api_key":"test-driver-key","api_secret":"hunter2-secret",'
    const res = await request('POST', '/api/auth', raw)
    errorLog.mock.restore()
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'HTTP_400')
    assert.ok(!JSON.stringify(res.body).includes('hunter2'))
    assert.equal(errorLog.mock.callCount(), 0)
  })

  it('returns 400 for missing or empty fields', async () => {
    for (const body of [{}, { api_key: 'test-driver-key' }, { api_key: '', api_secret: '' }]) {
      const res = await request('POST', '/api/auth', body)
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    }
  })
})

describe('Authorization on /api/*', () => {
  const guarded: Array<[string, string]> = [
    ['POST', '/api/users/bootstrap'],
    ['POST', '/api/drivers/cars/list'],
    ['POST', '/api/clients/plans/list'],
    ['GET', '/api/vnmap/directions?origin=1,1&destination=2,2'],
    ['POST', '/api/nonexistent'],
  ]

  it('returns 401 in the error envelope without a valid header', async () => {
    for (const [method, path] of guarded) {
      for (const headers of [{}, { Authorization: 'Basic abc' }, { Authorization: 'Bearer x' }]) {
        const res = await request(method, path, method === 'GET' ? undefined : {}, headers)
        assert.equal(res.status, 401, `${method} ${path}`)
        assert.equal(res.body.error.code, 'HTTP_401')
      }
    }
  })

  it('returns 401, not a parser error, for malformed JSON without a valid header', async () => {
    for (const path of ['/api/users/bootstrap', '/api/drivers/cars/list', '/api/clients/plans/list']) {
      const res = await request('POST', path, '{"broken":')
      assert.equal(res.status, 401, path)
      assert.equal(res.body.error.code, 'HTTP_401')
    }
  })

  it('returns 400 for malformed JSON with a valid header', async () => {
    const res = await request('POST', '/api/users/bootstrap', '{"broken":', authHeader())
    assert.equal(res.status, 400)
    assert.equal(res.body.error.message, 'Invalid request body')
  })

  it('lets a valid header through to the route', async () => {
    const res = await request('POST', '/api/users/bootstrap', {}, authHeader())
    assert.equal(res.status, 400) // reaches the controller: mauid is required
  })

  it('keeps /health and OPTIONS preflight open', async () => {
    assert.equal((await request('GET', '/health')).status, 200)
    const preflight = await request('OPTIONS', '/api/drivers/cars/list', undefined, {
      Origin: 'https://example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    })
    assert.equal(preflight.status, 204)
  })
})
