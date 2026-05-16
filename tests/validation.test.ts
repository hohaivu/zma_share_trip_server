import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

import express, { type Express, type Request, type Response } from 'express'

import { validateSchema } from '../src/middleware/validate'
import { manualTopUpBodySchema } from '../src/schemas/driverWallet'

/**
 * Smoke test for the zod-based request validation boundary.
 *
 * We deliberately avoid mounting the full app (which would require Postgres).
 * Instead we wire `validateSchema` to a stub handler so the test only exercises
 * the validation middleware contract and the documented 400 error envelope.
 */

interface ResponseShape {
  status: number
  body: any
}

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
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
        headers: { 'Content-Type': 'application/json' },
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
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

let server: http.Server
let invokedWithBody: unknown

before(async () => {
  const app: Express = express()
  app.use(express.json())
  app.post(
    '/topups',
    validateSchema('body', manualTopUpBodySchema),
    (req: Request, res: Response) => {
      invokedWithBody = req.body
      res.status(201).json({ ok: true, received: req.body })
    },
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

describe('validateSchema middleware', () => {
  it('forwards valid payloads to the downstream handler', async () => {
    invokedWithBody = undefined
    const res = await request(server, 'POST', '/topups', {
      driverId: 'driver-1',
      amountVnd: 50000,
      description: 'first top up',
    })

    assert.equal(res.status, 201)
    assert.deepEqual(invokedWithBody, {
      driverId: 'driver-1',
      amountVnd: 50000,
      description: 'first top up',
    })
    assert.equal(res.body.ok, true)
  })

  it('returns the documented 400 envelope for invalid payloads', async () => {
    invokedWithBody = undefined
    const res = await request(server, 'POST', '/topups', {
      driverId: '',
      amountVnd: -5,
    })

    assert.equal(res.status, 400)
    assert.equal(invokedWithBody, undefined) // handler was not reached
    assert.ok(res.body.error, 'expected error envelope')
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    assert.equal(res.body.error.message, 'Invalid request')
    assert.ok(Array.isArray(res.body.error.issues))
    assert.ok(res.body.error.issues.length >= 1)

    const issue = res.body.error.issues[0]
    assert.ok(Array.isArray(issue.path))
    assert.equal(typeof issue.message, 'string')
    assert.equal(typeof issue.code, 'string')
  })

  it('rejects non-integer amountVnd with a 400', async () => {
    const res = await request(server, 'POST', '/topups', {
      driverId: 'driver-1',
      amountVnd: 12.5,
    })

    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'VALIDATION_ERROR')
    const paths = res.body.error.issues.map((i: { path: unknown[] }) =>
      i.path.join('.'),
    )
    assert.ok(paths.includes('amountVnd'))
  })
})
