const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const express = require('express')

// Build a test app identical to index.js but without listening on a fixed port
function createApp() {
  const app = express()
  app.use(express.json())

  // Zalo proxy routes
  app.use('/api', require('./routes/authorize'))
  app.use('/api', require('./routes/userInfo'))
  app.use('/api', require('./routes/phoneNumber'))
  app.use('/api', require('./routes/location'))

  // Preserved
  app.use('/api', require('./routes/cars'))

  // Phase 2
  app.use('/api', require('./routes/driverRoutes'))
  app.use('/api', require('./routes/tripPlans'))
  app.use('/api', require('./routes/users'))
  app.use('/api', require('./routes/demandGroups'))
  app.use('/api', require('./routes/matches'))
  app.use('/api', require('./routes/trips'))
  app.use('/api', require('./routes/groupRequests'))
  app.use('/api', require('./routes/groupOffers'))
  app.use('/api', require('./routes/searchRequests'))

  return app
}

// Simple fetch helper
function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address()
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

let server

before(() => {
  return new Promise((resolve) => {
    const app = createApp()
    server = app.listen(0, resolve)
  })
})

after(() => {
  return new Promise((resolve) => {
    server.close(resolve)
  })
})

// ─── 6.7 Route-handler tests ──────────────────────────────────────────────────

describe('POST /api/trip-plans', () => {
  it('creates a trip plan', async () => {
    const res = await request(server, 'POST', '/api/trip-plans', {
      clientId: 'client-001',
      pickup: { lat: 10.77, lng: 106.70, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-test',
      dropoffWardId: 'ward-test2',
      serviceDate: '2030-04-01',
      departureBlockStart: '2030-04-01T08:00:00.000Z',
      departureBlockEnd: '2030-04-01T08:30:00.000Z',
      passengerCount: 1,
      publishMode: 'grouped',
    })
    assert.equal(res.status, 201)
    assert.ok(res.body.id)
    assert.equal(res.body.clientId, 'client-001')
    assert.equal(res.body.publishMode, 'grouped')
  })

  it('rejects without clientId', async () => {
    const res = await request(server, 'POST', '/api/trip-plans', {})
    assert.equal(res.status, 400)
  })
})

describe('POST /api/routes', () => {
  it('creates a driver route', async () => {
    const res = await request(server, 'POST', '/api/routes', {
      driverId: 'driver-001',
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.70, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-01',
      departureTime: '2030-04-01T07:00:00.000Z',
      tripPrice: 150000,
    })
    assert.equal(res.status, 201)
    assert.ok(res.body.id)
    assert.equal(res.body.tripPrice, 150000)
  })
})

describe('GET /api/routes/:id/matched-demand-groups', () => {
  it('returns matched demand groups for a route', async () => {
    const res = await request(server, 'GET', '/api/routes/route-001/matched-demand-groups')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body))
  })

  it('returns 404 for unknown route', async () => {
    const res = await request(server, 'GET', '/api/routes/route-999/matched-demand-groups')
    assert.equal(res.status, 404)
  })
})

describe('POST /api/search-requests', () => {
  it('creates a search request for search_only plan', async () => {
    // Create a fresh route so it's available
    const routeRes = await request(server, 'POST', '/api/routes', {
      driverId: 'driver-001',
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.70, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-02',
      departureTime: '2030-04-02T07:00:00.000Z',
      tripPrice: 100000,
    })

    // Create a search_only trip plan
    const tpRes = await request(server, 'POST', '/api/trip-plans', {
      clientId: 'client-001',
      pickup: { lat: 10.77, lng: 106.70, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-test',
      dropoffWardId: 'ward-test2',
      serviceDate: '2030-04-02',
      departureBlockStart: '2030-04-02T07:00:00.000Z',
      departureBlockEnd: '2030-04-02T07:30:00.000Z',
      passengerCount: 1,
      publishMode: 'search_only',
    })

    const res = await request(server, 'POST', '/api/search-requests', {
      clientId: 'client-001',
      tripPlanId: tpRes.body.id,
      routeId: routeRes.body.id,
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'pending')
  })

  it('rejects for grouped trip plan', async () => {
    const res = await request(server, 'POST', '/api/search-requests', {
      clientId: 'client-001',
      tripPlanId: 'tripPlan-001',
      routeId: 'route-001',
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('search_only'))
  })
})

// ─── 6.8 Regression tests for preserved endpoints ────────────────────────────

describe('preserved endpoints', () => {
  it('POST /api/authorize returns 200', async () => {
    const res = await request(server, 'POST', '/api/authorize', { code: 'test' })
    // authorize route makes an external call, so it should return 500 or similar
    // in test — we just verify the endpoint exists and doesn't 404
    assert.ok([200, 400, 401, 500].includes(res.status), 'Endpoint should exist')
  })

  it('POST /api/user-info returns response', async () => {
    const res = await request(server, 'POST', '/api/user-info', { accessToken: 'test' })
    assert.ok([200, 400, 401, 500].includes(res.status))
  })

  it('POST /api/phone-number returns response', async () => {
    const res = await request(server, 'POST', '/api/phone-number', {
      accessToken: 'test',
      code: 'test',
    })
    assert.ok([200, 400, 401, 500].includes(res.status))
  })

  it('POST /api/location returns response', async () => {
    const res = await request(server, 'POST', '/api/location', {
      accessToken: 'test',
      token: 'test',
    })
    assert.ok([200, 400, 401, 500].includes(res.status))
  })

  it('GET /api/cars?ownerId= works', async () => {
    const res = await request(server, 'GET', '/api/cars?ownerId=driver-001')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body))
  })

  it('POST /api/cars works', async () => {
    const res = await request(server, 'POST', '/api/cars', {
      ownerId: 'driver-001',
      plateNumberFull: '51A-999.99',
      brand: 'Test',
      model: 'Test',
      color: '#000',
      seatCapacity: 4,
    })
    assert.equal(res.status, 201)
    assert.ok(res.body.id)
  })
})
