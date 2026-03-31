import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from './index';
import {
  setupTestDb,
  teardownTestDb,
  createDbTest,
  isDbAvailable,
} from './test-db';

const it = createDbTest('Postgres unavailable for DB-backed API tests')

const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'

// Simple fetch helper
function request(server: any, method: string, path: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const addr = server.address()
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    const req = http.request(options, (res: any) => {
      let data = ''
      res.on('data', (chunk: any) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
          })
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

let server: any;

before(async () => {
  await setupTestDb()
  if (!isDbAvailable()) return
  return new Promise((resolve) => {
    server = app.listen(0, resolve)
  })
})

after(async () => {
  await teardownTestDb()
  if (!server) return
  return new Promise((resolve) => {
    server.close(resolve)
  })
})

// ─── 6.7 Route-handler tests ──────────────────────────────────────────────────

describe('POST /api/client/trip-plans', () => {
  it('creates a trip plan', async () => {
    const res = await request(server, 'POST', '/api/client/trip-plans', {
      clientId: CLIENT_001_ID,
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
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
    assert.equal(res.body.clientId, CLIENT_001_ID)
    assert.equal(res.body.publishMode, 'grouped')
  })

  it('rejects without clientId', async () => {
    const res = await request(server, 'POST', '/api/client/trip-plans', {})
    assert.equal(res.status, 400)
  })
})

describe('POST /api/client/search-routes', () => {
  it('returns matched routes from submitted criteria', async () => {
    const res = await request(server, 'POST', '/api/client/search-routes', {
      clientId: CLIENT_001_ID,
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-test',
      dropoffWardId: 'ward-test2',
      serviceDate: '2030-04-01',
      departureBlockStart: '2030-04-01T08:00:00.000Z',
      departureBlockEnd: '2030-04-01T08:30:00.000Z',
    })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body))
  })

  it('rejects without required criteria', async () => {
    const res = await request(server, 'POST', '/api/client/search-routes', {
      clientId: CLIENT_001_ID,
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('required'))
  })
})

describe('POST /api/driver/routes', () => {
  it('creates a driver route', async () => {
    const res = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-01',
      departureTime: '2030-04-01T07:00:00.000Z',
      tripPrice: 150000,
    })
    assert.equal(res.status, 201)
    assert.ok(res.body.id)
    assert.equal(res.body.tripPrice, 150000)
  })

  it('rejects create with unresolved 0/0 origin coordinates', async () => {
    const res = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 0, lng: 0, label: '0,0' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-01',
      departureTime: '2030-04-01T07:00:00.000Z',
      tripPrice: 150000,
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('Unresolved exact-point'))
  })

  it('rejects create without origin or destination payload', async () => {
    const res = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-01',
      departureTime: '2030-04-01T07:00:00.000Z',
      tripPrice: 150000,
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('required'))
  })
})

describe('PUT /api/driver/routes/:id', () => {
  it('updates route with valid resolved coordinates', async () => {
    // Note: since test-db might 404 the update itself, it shouldn't 400.
    const res = await request(server, 'PUT', '/api/driver/routes/route-123', {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
    })
    if (res.status === 400) assert.fail('Should not fail validation for valid resolved coordinates')
    assert.ok(res.status === 200 || res.status === 404)
  })
  it('rejects update with unresolved 0/0 destination coordinates', async () => {
    const res = await request(server, 'PUT', '/api/driver/routes/route-123', {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 0, lng: 0, label: '0,0' },
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('Unresolved exact-point'))
  })
})

describe('GET /api/driver/routes/:id/matched-demand-groups', () => {
  it('returns matched demand groups for a route', async () => {
    const res = await request(
      server,
      'GET',
      '/api/driver/routes/route-001/matched-demand-groups',
    )
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body))
  })

  it('returns 404 for unknown route', async () => {
    const res = await request(
      server,
      'GET',
      '/api/driver/routes/route-999/matched-demand-groups',
    )
    assert.equal(res.status, 404)
  })
})

describe('POST /api/client/search-requests', () => {
  it('creates a search request for search_only plan', async () => {
    // Create a fresh route so it's available
    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-02',
      departureTime: '2030-04-02T07:00:00.000Z',
      tripPrice: 100000,
    })

    // Create a search_only trip plan
    const tpRes = await request(server, 'POST', '/api/client/trip-plans', {
      clientId: CLIENT_001_ID,
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-test',
      dropoffWardId: 'ward-test2',
      serviceDate: '2030-04-02',
      departureBlockStart: '2030-04-02T07:00:00.000Z',
      departureBlockEnd: '2030-04-02T07:30:00.000Z',
      passengerCount: 1,
      publishMode: 'search_only',
    })

    const res = await request(server, 'POST', '/api/client/search-requests', {
      clientId: CLIENT_001_ID,
      planId: tpRes.body.id,
      routeId: routeRes.body.id,
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'pending')
  })
  it('creates a search request without a planId', async () => {
    // Create a fresh route so it's available
    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-03',
      departureTime: '2030-04-03T07:00:00.000Z',
      tripPrice: 100000,
    })

    const res = await request(server, 'POST', '/api/client/search-requests', {
      clientId: CLIENT_001_ID,
      routeId: routeRes.body.id,
      note: 'Hello without plan',
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'pending')
    assert.equal(res.body.planId, null)
  })
  it('accepts a grouped plan as optional linked context', async () => {
    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-04',
      departureTime: '2030-04-04T07:00:00.000Z',
      tripPrice: 100000,
    })

    const res = await request(server, 'POST', '/api/client/search-requests', {
      clientId: CLIENT_001_ID,
      planId: 'plan-001',
      routeId: routeRes.body.id,
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.planId, 'plan-001')
  })

  it('rejects when planId does not exist', async () => {
    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-05',
      departureTime: '2030-04-05T07:00:00.000Z',
      tripPrice: 100000,
    })

    const res = await request(server, 'POST', '/api/client/search-requests', {
      clientId: CLIENT_001_ID,
      planId: 'plan-missing',
      routeId: routeRes.body.id,
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('Plan not found'))
  })
})

// ─── 6.8 Regression tests for preserved endpoints ────────────────────────────

describe('preserved endpoints', () => {
  it('POST /api/authorize returns 200', async () => {
    const res = await request(server, 'POST', '/api/authorize', {
      code: 'test',
    })
    // authorize route makes an external call, so it should return 500 or similar
    // in test — we just verify the endpoint exists and doesn't 404
    assert.ok(
      [200, 400, 401, 500].includes(res.status),
      'Endpoint should exist',
    )
  })

  it('POST /api/user-info returns response', async () => {
    const res = await request(server, 'POST', '/api/user-info', {
      accessToken: 'test',
    })
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

  it('GET /api/driver/cars?ownerId= works', async () => {
    const res = await request(
      server,
      'GET',
      `/api/driver/cars?ownerId=${DRIVER_001_ID}`,
    )
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body))
  })

  it('POST /api/driver/cars works', async () => {
    const res = await request(server, 'POST', '/api/driver/cars', {
      ownerId: DRIVER_001_ID,
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

// ─── Bootstrap endpoint tests ─────────────────────────────────────────────────

describe('POST /api/users/bootstrap', () => {
  it('creates a new user on first bootstrap (201)', async () => {
    const res = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-new-user-001',
      displayName: 'New Test User',
      avatarUrl: 'https://example.com/avatar.png',
    })
    assert.equal(res.status, 201)
    assert.ok(res.body.id, 'should return a backend UUID id')
    assert.notEqual(res.body.id, 'zalo-new-user-001', 'id !== mauid')
    assert.equal(res.body.mauid, 'zalo-new-user-001')
    assert.equal(res.body.displayName, 'New Test User')
    assert.equal(res.body.avatarUrl, 'https://example.com/avatar.png')
  })

  it('resolves existing user on repeated bootstrap (200)', async () => {
    // First bootstrap
    const first = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-repeat-user-001',
      displayName: 'Repeat User',
      avatarUrl: '',
    })
    assert.equal(first.status, 201)

    // Repeated bootstrap with same mauid
    const second = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-repeat-user-001',
      displayName: 'Repeat User Updated',
      avatarUrl: 'https://example.com/new-avatar.png',
    })
    assert.equal(second.status, 200)
    assert.equal(second.body.id, first.body.id, 'backend id should be stable')
    assert.equal(second.body.mauid, 'zalo-repeat-user-001')
    assert.equal(second.body.displayName, 'Repeat User Updated')
    assert.equal(second.body.avatarUrl, 'https://example.com/new-avatar.png')
  })

  it('returns 400 when mauid is missing', async () => {
    const res = await request(server, 'POST', '/api/users/bootstrap', {
      displayName: 'No Mauid',
      avatarUrl: '',
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('mauid'))
  })

  it('returns 400 when displayName is missing', async () => {
    const res = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-missing-name',
      avatarUrl: '',
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('displayName'))
  })

  it('returns 400 when avatarUrl is missing', async () => {
    const res = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-missing-avatar',
      displayName: 'Missing Avatar',
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.message.includes('avatarUrl'))
  })
})

// ─── User mode endpoints with bootstrapped UUID user IDs ──────────────────────

describe('user mode with bootstrapped users', () => {
  it('saves and reads preferred mode using backend UUID', async () => {
    // Bootstrap a user first
    const bootstrap = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-mode-test-001',
      displayName: 'Mode Test',
      avatarUrl: '',
    })
    const userId = bootstrap.body.id

    // Save mode
    const saveRes = await request(
      server,
      'POST',
      `/api/users/${userId}/mode`,
      { preferredMode: 'driver' },
    )
    assert.equal(saveRes.status, 200)
    assert.equal(saveRes.body.preferredMode, 'driver')

    // Read mode
    const readRes = await request(
      server,
      'GET',
      `/api/users/${userId}/mode`,
    )
    assert.equal(readRes.status, 200)
    assert.equal(readRes.body.preferredMode, 'driver')
  })
})
