import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express'

import { HttpError } from '../src/http-error'
import { asyncHandler } from '../src/routes/helpers'
import {
  created,
  errorBody,
  httpErrorCode,
  ok,
} from '../src/shared/responseEnvelope'

/**
 * Pure-helper + middleware-shape tests for the ALI-55 response envelope.
 *
 * These do not require a database, so they exercise the envelope contract on
 * every CI run (even when Postgres is unavailable and DB-backed tests skip).
 */

interface ResponseShape {
  status: number
  body: any
}

function request(
  server: http.Server,
  method: string,
  path: string,
): Promise<ResponseShape> {
  return new Promise((resolve, reject) => {
    const addr = server.address()
    if (!addr || typeof addr === 'string') {
      reject(new Error('Server has no port'))
      return
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => (data += chunk.toString()))
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: data ? JSON.parse(data) : null,
            })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data })
          }
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('responseEnvelope helpers', () => {
  it('ok() wraps payload as { data }', () => {
    assert.deepEqual(ok({ a: 1 }), { data: { a: 1 } })
  })

  it('ok() with meta includes { data, meta }', () => {
    assert.deepEqual(ok([1, 2, 3], { count: 3 }), {
      data: [1, 2, 3],
      meta: { count: 3 },
    })
  })

  it('created() is an alias of ok()', () => {
    assert.deepEqual(created({ id: 'x' }), { data: { id: 'x' } })
  })

  it('errorBody() emits a minimal error envelope', () => {
    assert.deepEqual(errorBody('HTTP_400', 'bad input'), {
      error: { code: 'HTTP_400', message: 'bad input' },
    })
  })

  it('errorBody() includes issues and details when provided', () => {
    const body = errorBody('VALIDATION_ERROR', 'Invalid request', {
      issues: [{ path: ['amountVnd'], message: 'too small', code: 'too_small' }],
      details: { hint: 'top up first' },
    })
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.equal(body.error.issues?.length, 1)
    assert.deepEqual(body.error.details, { hint: 'top up first' })
  })

  it('httpErrorCode() derives stable codes from status', () => {
    assert.equal(httpErrorCode(400), 'HTTP_400')
    assert.equal(httpErrorCode(404), 'HTTP_404')
    assert.equal(httpErrorCode(500), 'HTTP_500')
  })
})

let server: http.Server

before(async () => {
  const app: Express = express()
  app.use(express.json())

  app.get(
    '/ok',
    asyncHandler((_req: Request, res: Response) => {
      res.json(ok({ hello: 'world' }))
    }),
  )

  app.get(
    '/list',
    asyncHandler((_req: Request, res: Response) => {
      const items = [{ id: 'a' }, { id: 'b' }]
      res.json(ok(items, { count: items.length }))
    }),
  )

  app.get(
    '/bad',
    asyncHandler((_req: Request, _res: Response) => {
      throw new HttpError(400, 'bad request')
    }),
  )

  app.get(
    '/missing',
    asyncHandler((_req: Request, _res: Response) => {
      throw new HttpError(404, 'thing not found')
    }),
  )

  // Silence the [server error] noise in test output.
  const origConsoleError = console.error
  app.get(
    '/boom',
    asyncHandler((_req: Request, _res: Response, _next: NextFunction) => {
      console.error = () => {
        console.error = origConsoleError
      }
      throw new Error('kaboom')
    }),
  )

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('response envelope at the route boundary', () => {
  it('GET success returns { data } envelope', async () => {
    const res = await request(server, 'GET', '/ok')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { data: { hello: 'world' } })
  })

  it('GET list returns { data, meta: { count } }', async () => {
    const res = await request(server, 'GET', '/list')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, {
      data: [{ id: 'a' }, { id: 'b' }],
      meta: { count: 2 },
    })
  })

  it('400 from HttpError uses { error: { code: HTTP_400, message } }', async () => {
    const res = await request(server, 'GET', '/bad')
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'HTTP_400')
    assert.equal(res.body.error.message, 'bad request')
  })

  it('404 from HttpError uses { error: { code: HTTP_404, message } }', async () => {
    const res = await request(server, 'GET', '/missing')
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'HTTP_404')
    assert.equal(res.body.error.message, 'thing not found')
  })

  it('500 from unknown error returns generic envelope without leaking message', async () => {
    const res = await request(server, 'GET', '/boom')
    assert.equal(res.status, 500)
    assert.equal(res.body.error.code, 'HTTP_500')
    assert.equal(res.body.error.message, 'Internal server error')
  })
})
