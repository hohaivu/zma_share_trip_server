import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

import app from '../src/index.js'

function request(path: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const address = server.address()
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: typeof address === 'object' && address ? address.port : 0,
        path,
        method: 'GET',
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body,
            headers: res.headers,
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

let server: http.Server

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
})

describe('VNMap proxy routes', () => {
  const originalFetch = global.fetch
  const originalApiKey = process.env.VNMAP_API_KEY

  after(() => {
    global.fetch = originalFetch
    process.env.VNMAP_API_KEY = originalApiKey
  })

  it('proxies autocomplete with backend-only key and legacy provider defaults', async () => {
    process.env.VNMAP_API_KEY = 'secret-key'

    let calledUrl = ''
    global.fetch = (async (input: string | URL | globalThis.Request) => {
      calledUrl = String(input)
      return new Response(JSON.stringify({ status: 'OK', predictions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof global.fetch

    const res = await request('/api/vnmap/place/autocomplete?input=Nguyen%20Hue&location=10.7,106.6')

    assert.equal(res.status, 200)
    assert.equal(res.body, JSON.stringify({ status: 'OK', predictions: [] }))

    const providerUrl = new URL(calledUrl)
    assert.equal(providerUrl.origin, 'https://api.vnmap.com.vn')
    assert.equal(providerUrl.pathname, '/place/autocomplete')
    assert.equal(providerUrl.searchParams.get('input'), 'Nguyen Hue')
    assert.equal(providerUrl.searchParams.get('location'), '10.7,106.6')
    assert.equal(providerUrl.searchParams.get('key'), 'secret-key')
    assert.equal(providerUrl.searchParams.get('components'), 'country:vn')
    assert.equal(providerUrl.searchParams.get('language'), 'vi')
    assert.equal(providerUrl.searchParams.get('from_source'), null)
    assert.equal(providerUrl.searchParams.get('type_source'), null)
    assert.equal(providerUrl.searchParams.get('province_id'), null)
    assert.equal(providerUrl.searchParams.get('user_id'), null)
    assert.equal(providerUrl.searchParams.get('type_app'), null)
  })

  it('returns 503 when backend VNMap key missing', async () => {
    delete process.env.VNMAP_API_KEY
    global.fetch = originalFetch

    const res = await request('/api/vnmap/place/details?place_id=place-1')

    assert.equal(res.status, 503)
    assert.match(res.body, /VNMap API key is not configured/)
    assert.doesNotMatch(res.body, /key=/)
  })

  it('returns 502 for provider network failure', async () => {
    process.env.VNMAP_API_KEY = 'secret-key'
    global.fetch = (async () => {
      throw new Error('network down')
    }) as typeof global.fetch

    const res = await request('/api/vnmap/directions?origin=10,106&destination=11,107')

    assert.equal(res.status, 502)
    assert.match(res.body, /VNMap provider request failed/)
  })

  it('passes through provider failure status/body', async () => {
    process.env.VNMAP_API_KEY = 'secret-key'
    global.fetch = (async () =>
      new Response(JSON.stringify({ status: 'REQUEST_DENIED' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as typeof global.fetch

    const res = await request('/api/vnmap/place/details?place_id=place-1')

    assert.equal(res.status, 401)
    assert.equal(res.body, JSON.stringify({ status: 'REQUEST_DENIED' }))
  })
})
