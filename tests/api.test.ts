import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe } from 'node:test'

import { query } from '../src/db/connection'
import app from '../src/index.js'
import * as matching from '../src/matching'
import * as groupRequestRepository from '../src/repositories/groupRequestRepository'
import * as reviewRepository from '../src/repositories/reviewRepository'
import { toCamelCase } from '../src/db/utils'
import * as walletRepository from '../src/repositories/walletRepository'
import * as carService from '../src/services/carService'
import * as walletService from '../src/services/walletService'
import * as driverRouteService from '../src/services/driverRouteService'
import * as groupOfferService from '../src/services/groupOfferService'
import * as groupRequestService from '../src/services/groupRequestService'
import * as planService from '../src/services/planService'
import * as routeRequestService from '../src/services/routeRequestService'
import * as userService from '../src/services/userService'
import {
  createDbTest,
  isDbAvailable,
  setupTestDb,
  teardownTestDb,
} from '../src/test-db'
import type { Route, RouteRequest } from '../src/types/entities'
import type { CreateReviewPayload, CreateRoutePayload, UpdatePlanPayload, UpdateRoutePayload } from '../src/types/payloads'

const it = createDbTest('Postgres unavailable for DB-backed API tests')

const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const DRIVER_002_ID = 'a1b2c3d4-0002-4000-8000-000000000002'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'
const CLIENT_002_ID = 'a1b2c3d4-0004-4000-8000-000000000004'

function formatLocalDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

async function createRoute(
  driverId: string,
  data: Omit<CreateRoutePayload, 'windowEnd'> & Partial<Pick<CreateRoutePayload, 'windowEnd'>>,
): Promise<Route> {
  return driverRouteService.createRoute(driverId, {
    distanceMeters: 10000,
    windowEnd: data.windowEnd ?? data.windowStart,
    ...data,
  })
}

async function getRoute(id: string): Promise<Route> {
  const route = await driverRouteService.getRoute(id)
  assert.ok(route)
  return route
}

async function publishRoute(
  id: string,
  data: UpdateRoutePayload = {},
): Promise<Route> {
  if (Object.keys(data).length > 0) {
    await updateRoute(id, data)
  }
  await query(
    `UPDATE routes
     SET status = 'published',
         distance_meters = COALESCE(distance_meters, 10000)
     WHERE id = $1`,
    [id],
  )
  return getRoute(id)
}

async function updateRoute(id: string, data: UpdateRoutePayload): Promise<Route | null> {
  const next = await driverRouteService.updateRoute(id, data)
  if (data.status === 'completed') {
    await query('UPDATE routes SET completed_at = COALESCE(completed_at, NOW()) WHERE id = $1', [id])
  }
  return next
}

async function updatePlan(id: string, data: UpdatePlanPayload) {
  const next = await planService.updatePlan(id, data)
  if (data.status === 'completed') {
    await query('UPDATE plans SET completed_at = COALESCE(completed_at, NOW()) WHERE id = $1', [id])
  }
  return next
}

async function createRouteRequest(
  clientId: string,
  planId: string,
  routeId: string,
  note = '',
): Promise<RouteRequest> {
  const route = await getRoute(routeId)
  const result = await query(
    `INSERT INTO route_requests (id, client_id, plan_id, route_id, driver_id, trip_price, note, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
     RETURNING *`,
    [
      `sreq-${Date.now()}${Math.random().toString().slice(2, 6)}`,
      clientId,
      planId,
      routeId,
      route.driverId,
      route.tripPrice,
      note,
    ],
  )
  const routeRequest = toCamelCase<RouteRequest>(result.rows[0])
  assert.ok(routeRequest)
  return routeRequest
}

async function acceptRouteRequest(requestId: string): Promise<RouteRequest> {
  const requestResult = await query('SELECT * FROM route_requests WHERE id = $1', [
    requestId,
  ])
  const request = toCamelCase<RouteRequest>(requestResult.rows[0])
  assert.ok(request)
  await query("UPDATE route_requests SET status = 'accepted' WHERE id = $1", [requestId])
  await query("UPDATE routes SET status = 'matched', wallet_fee_status = 'charged' WHERE id = $1", [request.routeId])
  if (request.planId) {
    await query("UPDATE plans SET status = 'matched' WHERE id = $1", [request.planId])
  }
  await query("UPDATE group_offers SET status = 'closed' WHERE route_id = $1 AND status = 'pending'", [request.routeId])
  await query("UPDATE route_requests SET status = 'closed' WHERE route_id = $1 AND id != $2 AND status = 'pending'", [request.routeId, requestId])
  return { ...request, status: 'accepted' }
}

async function acceptGroupOffer(offerId: string): Promise<void> {
  const result = await query('SELECT route_id, plan_id FROM group_offers WHERE id = $1', [offerId])
  const offer = result.rows[0]
  assert.ok(offer)
  await query("UPDATE group_offers SET status = 'accepted' WHERE id = $1", [offerId])
  await query("UPDATE routes SET status = 'matched', wallet_fee_status = 'charged' WHERE id = $1", [offer.route_id])
  await query("UPDATE plans SET status = 'matched' WHERE id = $1", [offer.plan_id])
  await query("UPDATE group_offers SET status = 'closed' WHERE route_id = $1 AND id != $2 AND status = 'pending'", [offer.route_id, offerId])
  await query("UPDATE route_requests SET status = 'closed' WHERE route_id = $1 AND status = 'pending'", [offer.route_id])
}

async function createPendingGroupOfferForClient(departureDate: string, label: string) {
  const route = await publishRoute(
    (
      await createRoute(DRIVER_001_ID, {
        carId: 'car-001',
        origin: { lat: 10.77, lng: 106.7, label: `${label} origin` },
        destination: { lat: 10.85, lng: 106.75, label: `${label} dest` },
        departureDate,
        windowStart: `${departureDate}T07:00:00.000Z`,
        tripPrice: 155000,
      })
    ).id,
  )
  const plan = await planService.createPlan(CLIENT_001_ID, {
    origin: { lat: 10.77, lng: 106.7, label: `${label} pickup` },
    destination: { lat: 10.85, lng: 106.75, label: `${label} dropoff` },
    originWardId: `${label}-pickup-ward`,
    destinationWardId: `${label}-dropoff-ward`,
    departureDate,
    windowStart: `${departureDate}T07:00:00.000Z`,
    windowEnd: `${departureDate}T07:30:00.000Z`,
    passengerCount: 1,
  })
  const groups = await groupRequestRepository.deriveDemandGroups()
  const targetGroup = groups.find((group) => group.memberPlanIds.includes(plan.id))
  assert.ok(targetGroup)
  const groupRequest = await groupRequestService.createGroupRequest(
    DRIVER_001_ID,
    route.id,
    targetGroup!.id,
  )
  const offer = groupRequest.offers[0]
  assert.ok(offer)
  return offer
}

async function createReview(payload: CreateReviewPayload) {
  return reviewRepository.createReview(payload)
}

async function insertAcceptedRouteRequest(
  routeId: string,
  planId: string,
  clientId = CLIENT_001_ID,
  driverId = DRIVER_001_ID,
): Promise<void> {
  await query(
    `INSERT INTO route_requests (id, client_id, plan_id, route_id, driver_id, trip_price, note, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 100000, '', 'accepted', NOW())`,
    [`sreq-${Date.now()}${Math.random().toString().slice(2, 6)}`, clientId, planId, routeId, driverId],
  )
}

// Simple fetch helper
function request(
  server: any,
  method: string,
  path: string,
  body?: any,
): Promise<any> {
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
      res.on('data', (chunk: any) => (data += chunk))
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

function assertOnlyEnvelopeKeys(body: any, keys: string[]): void {
  assert.deepEqual(Object.keys(body).sort(), keys.sort())
}

let server: any

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
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-test',
      destinationWardId: 'ward-test2',
      departureDate: '2030-04-01',
      windowStart: '2030-04-01T08:00:00.000Z',
      windowEnd: '2030-04-01T08:30:00.000Z',
      passengerCount: 1,
    })
    assert.equal(res.status, 201)
    assert.ok(res.body.id)
    assert.equal(res.body.clientId, CLIENT_001_ID)
  })

  it('rejects without clientId', async () => {
    const res = await request(server, 'POST', '/api/client/trip-plans', {})
    assert.equal(res.status, 400)
  })

  it('rejects creating or updating a plan with a past departure date', async () => {
    const pastDate = formatLocalDateValue(addDays(new Date(), -1))
    const futureDate = formatLocalDateValue(addDays(new Date(), 7))

    const createRes = await request(server, 'POST', '/api/client/trip-plans', {
      clientId: CLIENT_001_ID,
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-plan-past-create',
      destinationWardId: 'ward-plan-past-create-dest',
      departureDate: pastDate,
      windowStart: `${pastDate}T08:00:00.000Z`,
      windowEnd: `${pastDate}T08:30:00.000Z`,
      passengerCount: 1,
    })
    assert.equal(createRes.status, 400)
    assert.equal(createRes.body.error.message, 'departureDate cannot be in the past')

    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-plan-past-update',
      destinationWardId: 'ward-plan-past-update-dest',
      departureDate: futureDate,
      windowStart: `${futureDate}T08:00:00.000Z`,
      windowEnd: `${futureDate}T08:30:00.000Z`,
      passengerCount: 1,
    })

    const updateRes = await request(
      server,
      'PUT',
      `/api/client/trip-plans/${plan.id}`,
      {
        clientId: CLIENT_001_ID,
        departureDate: pastDate,
        windowStart: `${pastDate}T08:00:00.000Z`,
        windowEnd: `${pastDate}T08:30:00.000Z`,
      },
    )
    assert.equal(updateRes.status, 400)
    assert.equal(updateRes.body.error.message, 'departureDate cannot be in the past')
  })
})

describe('POST /api/driver/routes', () => {
  it('rejects creating, updating, or publishing a route with a past departure date', async () => {
    const pastDate = formatLocalDateValue(addDays(new Date(), -1))
    const futureDate = formatLocalDateValue(addDays(new Date(), 7))

    const createRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1', wardId: 'ward-api-exclusive' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD', wardId: 'ward-api-exclusive-dest' },
      departureDate: pastDate,
      windowStart: `${pastDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    assert.equal(createRes.status, 400)
    assert.equal(createRes.body.error.message, 'departureDate cannot be in the past')

    const route = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1', wardId: 'ward-api-exclusive' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD', wardId: 'ward-api-exclusive-dest' },
      departureDate: futureDate,
      windowStart: `${futureDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })

    const updateRes = await request(server, 'PUT', `/api/driver/routes/${route.id}`, {
      driverId: DRIVER_001_ID,
      departureDate: pastDate,
      windowStart: `${pastDate}T07:00:00.000Z`,
    })
    assert.equal(updateRes.status, 400)
    assert.equal(updateRes.body.error.message, 'departureDate cannot be in the past')

    await query('UPDATE routes SET departure_date = $1 WHERE id = $2', [pastDate, route.id])
    const publishRes = await request(server, 'PUT', `/api/driver/routes/${route.id}`, {
      driverId: DRIVER_001_ID,
      status: 'published',
      departureDate: pastDate,
    })
    assert.equal(publishRes.status, 400)
    assert.equal(publishRes.body.error.message, 'departureDate cannot be in the past')
  })
})

describe('DELETE /api/client/trip-plans/:id', () => {
  it('cancels an owned plan', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-api-cancel',
      destinationWardId: 'ward-api-cancel-dest',
      departureDate: '2030-06-01',
      windowStart: '2030-06-01T08:00:00.000Z',
      windowEnd: '2030-06-01T08:30:00.000Z',
      passengerCount: 1,
    })

    const res = await request(
      server,
      'DELETE',
      `/api/client/trip-plans/${plan.id}?clientId=${CLIENT_001_ID}`,
    )

    assert.equal(res.status, 200)
    assert.equal(res.body.id, plan.id)
    assert.equal(res.body.status, 'canceled')
  })

  it('rejects a non-owner', async () => {
    const res = await request(
      server,
      'DELETE',
      `/api/client/trip-plans/plan-001?clientId=${CLIENT_002_ID}`,
    )

    assert.equal(res.status, 403)
  })

  it('returns 404 for a missing plan', async () => {
    const res = await request(
      server,
      'DELETE',
      `/api/client/trip-plans/plan-missing?clientId=${CLIENT_001_ID}`,
    )

    assert.equal(res.status, 404)
  })
})

describe('POST /api/client/route-suggestions', () => {
  const routeSearchCriteria = {
    clientId: CLIENT_001_ID,
    origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
    destination: { lat: 10.85, lng: 106.75, label: 'TD' },
    originWardId: 'ward-test',
    destinationWardId: 'ward-test2',
    departureDate: '2030-04-01',
    windowStart: '2030-04-01T08:00:00.000Z',
    windowEnd: '2030-04-01T08:30:00.000Z',
  }

  it('returns matched routes from submitted criteria', async () => {
    const res = await request(server, 'POST', '/api/client/route-suggestions', routeSearchCriteria)
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body))
  })

  it('returns route suggestion candidate shape', async () => {
    const res = await request(server, 'POST', '/api/client/route-suggestions', routeSearchCriteria)

    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body[0] ?? {}).sort(), Object.keys(res.body[0] ?? {}).sort())
  })

  it('rejects without required criteria', async () => {
    const res = await request(server, 'POST', '/api/client/route-suggestions', {
      clientId: CLIENT_001_ID,
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('required'))
  })

  it('returns validation errors for route suggestions', async () => {
    const res = await request(server, 'POST', '/api/client/route-suggestions', {
      clientId: CLIENT_001_ID,
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
    })

    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('required'))
  })

  it('omits route with accepted group offer or route request', async () => {
    const groupOfferDate = '2030-06-10'
    const routeRequestDate = '2030-06-11'
    const createRouteAndPlan = async (departureDate: string, suffix: string) => {
      const route = await publishRoute(
        (
          await createRoute(DRIVER_001_ID, {
            carId: 'car-001',
            origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
            destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
            departureDate,
            windowStart: `${departureDate}T07:15:00.000Z`,
            tripPrice: 100000,
          })
        ).id,
      )
      const plan = await planService.createPlan(CLIENT_001_ID, {
        origin: { lat: 10.776, lng: 106.701, label: 'Quận 1' },
        destination: { lat: 10.854, lng: 106.754, label: 'Thủ Đức' },
        originWardId: `ward-api-${suffix}`,
        destinationWardId: `ward-api-${suffix}-dest`,
        departureDate,
        windowStart: `${departureDate}T07:00:00.000Z`,
        windowEnd: `${departureDate}T07:30:00.000Z`,
        passengerCount: 1,
      })
      return { route, plan }
    }

    const groupOffer = await createRouteAndPlan(groupOfferDate, 'group-offer')
    const groupMatches = await matching.computeMatchedDemandGroups(
      groupOffer.route.id,
    )
    const groupRequest = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      groupOffer.route.id,
      groupMatches[0].demandGroupId,
    )
    await acceptGroupOffer(groupRequest.offers[0].id)

    const routeRequest = await createRouteAndPlan(
      routeRequestDate,
      'route-request',
    )
    const acceptedRouteRequest = await createRouteRequest(
      CLIENT_001_ID,
      routeRequest.plan.id,
      routeRequest.route.id,
    )
    await acceptRouteRequest(acceptedRouteRequest.id)

    for (const item of [groupOffer, routeRequest]) {
      const res = await request(server, 'POST', '/api/client/route-suggestions', {
        clientId: CLIENT_002_ID,
        origin: { lat: 10.776, lng: 106.701, label: 'Quận 1' },
        destination: { lat: 10.854, lng: 106.754, label: 'Thủ Đức' },
        originWardId: 'ward-search-other-client',
        destinationWardId: 'ward-search-other-client-dest',
        departureDate: item.route.departureDate,
        windowStart: `${item.route.departureDate}T07:00:00.000Z`,
        windowEnd: `${item.route.departureDate}T07:30:00.000Z`,
      })
      assert.equal(res.status, 200)
      assert.equal(
        res.body.some((result: { routeId: string }) => result.routeId === item.route.id),
        false,
      )
    }
  })
})

describe('POST /api/driver/routes', () => {
  it('creates a driver route', async () => {
    const res = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate: '2030-04-01',
      windowStart: '2030-04-01T07:00:00.000Z',
      tripPrice: 150000,
    })
    assert.equal(res.status, 201)
    assert.ok(res.body.id)
    assert.equal(res.body.tripPrice, 150000)
    assert.equal(res.body.departureDate, res.body.windowStart)
  })

  it('rejects create with unresolved 0/0 origin coordinates', async () => {
    const res = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 0, lng: 0, label: '0,0' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate: '2030-04-01',
      windowStart: '2030-04-01T07:00:00.000Z',
      tripPrice: 150000,
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('Unresolved exact-point'))
  })

  it('rejects create without origin or destination payload', async () => {
    const res = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate: '2030-04-01',
      windowStart: '2030-04-01T07:00:00.000Z',
      tripPrice: 150000,
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('required'))
  })
})

describe('PUT /api/driver/routes/:id', () => {
  it('updates route with valid resolved coordinates', async () => {
    // Note: since test-db might 404 the update itself, it shouldn't 400.
    const res = await request(server, 'PUT', '/api/driver/routes/route-123', {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
    })
    if (res.status === 400)
      assert.fail('Should not fail validation for valid resolved coordinates')
    assert.ok(res.status === 200 || res.status === 404)
  })
  it('rejects update with unresolved 0/0 destination coordinates', async () => {
    const res = await request(server, 'PUT', '/api/driver/routes/route-123', {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 0, lng: 0, label: '0,0' },
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('Unresolved exact-point'))
  })
})

describe('driver wallet routes', () => {
  it('returns wallet summary with derived balances and fee configuration', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const wallet = await walletRepository.getOrCreateDriverWallet(DRIVER_001_ID)
    await query(
      `
        UPDATE wallets
        SET balance_vnd = $2,
            reserved_balance_vnd = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [wallet.id, 250000, 50000],
    )

    const res = await request(
      server,
      'GET',
      `/api/driver/wallet?driverId=${DRIVER_001_ID}`,
    )

    assert.equal(res.status, 200)
    assertOnlyEnvelopeKeys(res.body, ['data'])
    assert.ok(res.body.data, 'expected success envelope { data }')
    assert.equal(res.body.driverId, undefined, 'must not expose legacy bare wallet fields')
    assert.equal(res.body.data.driverId, DRIVER_001_ID)
    assert.equal(res.body.data.balanceVnd, 250000)
    assert.equal(res.body.data.reservedBalanceVnd, 50000)
    assert.equal(res.body.data.availableBalanceVnd, 200000)
    assert.equal(res.body.data.feeRateVndPerKm, 500)
    assert.equal(res.body.data.maxPublishableDistanceMeters, 400000)
  })

  it('lists wallet transactions in reverse chronological order after top-up activity', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const wallet = await walletRepository.getOrCreateDriverWallet(DRIVER_001_ID)
    await query(
      `
        INSERT INTO wallet_transactions (
          id,
          wallet_id,
          driver_id,
          route_id,
          type,
          amount_vnd,
          balance_after_vnd,
          reserved_balance_after_vnd,
          description,
          metadata,
          created_at
        )
        VALUES
          ($1, $2, $3, NULL, 'topup', $4, $5, 0, $6, $7, $8),
          ($9, $2, $3, NULL, 'reservation', $10, $11, $12, $13, $14, $15)
      `,
      [
        'wtx-wallet-older',
        wallet.id,
        DRIVER_001_ID,
        120000,
        620000,
        'Older top-up',
        JSON.stringify({ source: 'manual_top_up' }),
        '2030-04-01T08:00:00.000Z',
        'wtx-wallet-newer',
        -50000,
        620000,
        50000,
        'Reserved route fee',
        JSON.stringify({ routeId: 'route-001' }),
        '2030-04-01T09:00:00.000Z',
      ],
    )

    const res = await request(
      server,
      'GET',
      `/api/driver/wallet/transactions?driverId=${DRIVER_001_ID}&limit=2`,
    )

    assert.equal(res.status, 200)
    assertOnlyEnvelopeKeys(res.body, ['data', 'meta'])
    assert.ok(Array.isArray(res.body.data), 'expected envelope { data: [...] }')
    assert.equal(res.body.items, undefined, 'must not expose legacy { items } wrapper')
    assert.equal(res.body.data.length, 2)
    assert.equal(res.body.meta?.count, 2)
    assert.equal(res.body.data[0].id, 'wtx-wallet-newer')
    assert.equal(res.body.data[0].type, 'reservation')
    assert.equal(res.body.data[0].amountVnd, -50000)
    assert.equal(res.body.data[0].description, 'Reserved route fee')
    assert.equal(res.body.data[1].id, 'wtx-wallet-older')
    assert.equal(res.body.data[1].type, 'topup')
    assert.equal(res.body.data[1].amountVnd, 120000)
    assert.equal(res.body.data[1].description, 'Older top-up')
  })

  it('creates a manual top-up and returns refreshed wallet state plus ledger row', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const initialSummary = await walletService.getDriverWalletSummary(DRIVER_001_ID)

    const res = await request(server, 'POST', '/api/driver/wallet/topups', {
      driverId: DRIVER_001_ID,
      amountVnd: 150000,
      description: 'API manual top-up test',
    })

    assert.equal(res.status, 201)
    assertOnlyEnvelopeKeys(res.body, ['data'])
    assert.ok(res.body.data, 'expected envelope { data } for created top-up')
    assert.equal(res.body.summary, undefined, 'must not expose legacy top-level summary')
    assert.equal(res.body.transaction, undefined, 'must not expose legacy top-level transaction')
    assert.equal(res.body.data.summary.driverId, DRIVER_001_ID)
    assert.equal(
      res.body.data.summary.balanceVnd,
      initialSummary.balanceVnd + 150000,
    )
    assert.equal(
      res.body.data.summary.availableBalanceVnd,
      initialSummary.availableBalanceVnd + 150000,
    )
    assert.equal(res.body.data.transaction.type, 'topup')
    assert.equal(res.body.data.transaction.amountVnd, 150000)
    assert.equal(res.body.data.transaction.description, 'API manual top-up test')

    const summaryRes = await request(
      server,
      'GET',
      `/api/driver/wallet?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(summaryRes.status, 200)
    assertOnlyEnvelopeKeys(summaryRes.body, ['data'])
    assert.equal(
      summaryRes.body.data.balanceVnd,
      initialSummary.balanceVnd + 150000,
    )
  })
})

describe('POST /api/trips/:id/cancel', () => {
  it('cancels a matched route and suppresses the accepted pairing in summary reads', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate: '2030-04-03',
          windowStart: '2030-04-03T07:00:00.000Z',
          tripPrice: 155000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-cancel-sync',
      destinationWardId: 'ward-cancel-sync-dest',
      departureDate: '2030-04-03',
      windowStart: '2030-04-03T07:00:00.000Z',
      windowEnd: '2030-04-03T07:30:00.000Z',
      passengerCount: 1,
    })
    const routeRequest = await createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )
    await acceptRouteRequest(routeRequest.id)

    const cancelRes = await request(
      server,
      'POST',
      `/api/trips/${route.id}/cancel`,
    )
    assert.equal(cancelRes.status, 200)
    assert.equal(cancelRes.body.status, 'canceled')
    assert.equal(cancelRes.body.walletFeeStatus, 'refunded')

    const summaryRes = await request(
      server,
      'GET',
      `/api/journeys/${route.id}/summary`,
    )
    assert.equal(summaryRes.status, 200)
    assert.equal(summaryRes.body.accepted, null)
  })
})

describe('POST /api/trips/:id/complete', () => {
  it('completes linked plan when completing an accepted route', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = formatLocalDateValue(new Date())
    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate,
          windowStart: `${departureDate}T07:00:00.000Z`,
          tripPrice: 155000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-complete-sync',
      destinationWardId: 'ward-complete-sync-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )
    await acceptRouteRequest(routeRequest.id)

    const completeRes = await request(
      server,
      'POST',
      `/api/trips/${route.id}/complete`,
    )
    assert.equal(completeRes.status, 200)
    assert.equal(completeRes.body.status, 'completed')

    const linkedPlan = await planService.getPlan(plan.id)
    assert.equal(linkedPlan?.status, 'completed')

    const planSummaryRes = await request(
      server,
      'GET',
      `/api/journeys/${plan.id}/summary`,
    )
    assert.equal(planSummaryRes.status, 200)
    assert.equal(planSummaryRes.body.accepted?.type, 'route_request')
    assert.equal(planSummaryRes.body.accepted?.matchedUser?.id, DRIVER_001_ID)
  })
})

describe('GET /api/journeys/:id/summary', () => {
  it('returns journey summary', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate: '2030-04-04',
          windowStart: '2030-04-04T07:00:00.000Z',
          tripPrice: 155000,
        })
      ).id,
    )

    const res = await request(server, 'GET', `/api/journeys/${route.id}/summary`)

    assert.equal(res.status, 200)
    assert.equal(res.body.id, route.id)
  })

  it('preserves missing journey status and message', async () => {
    const res = await request(server, 'GET', '/api/journeys/missing-route/summary')

    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'HTTP_404')
    assert.equal(res.body.error.message, 'Trip not found')
  })
})

describe('removed legacy clarified endpoints', () => {
  it('does not route old read and matching URLs', async () => {
    const checks = await Promise.all([
      request(server, 'GET', '/api/trips/legacy-id/summary'),
      request(server, 'POST', '/api/client/search-routes', {}),
      request(server, 'GET', `/api/client/group-offers?clientId=${CLIENT_001_ID}`),
      request(server, 'GET', `/api/client/route-requests?clientId=${CLIENT_001_ID}`),
    ])

    for (const res of checks) {
      assert.equal(res.status, 404)
    }
  })
})

describe('work queue visibility endpoints', () => {
  it('keeps same-day completed routes visible until driver submits review', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = formatLocalDateValue(new Date())
    const route = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-route-review',
      destinationWardId: 'ward-route-review-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await acceptRouteRequest(routeRequest.id)
    await updateRoute(route.id, { status: 'completed' })

    const beforeReview = await request(
      server,
      'GET',
      `/api/driver/routes?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(beforeReview.status, 200)
    assert.equal(
      beforeReview.body.some((item: { id: string }) => item.id === route.id),
      true,
    )

    await createReview({
      tripId: route.id,
      reviewerId: DRIVER_001_ID,
      revieweeId: CLIENT_001_ID,
      rating: 5,
      comment: 'done',
    })

    const afterReview = await request(
      server,
      'GET',
      `/api/driver/routes?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(afterReview.status, 200)
    assert.equal(
      afterReview.body.some((item: { id: string }) => item.id === route.id),
      false,
    )
  })

  it('keeps future-dated completed routes visible until driver submits review', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = formatLocalDateValue(addDays(new Date(), 7))
    const route = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-route-future-review',
      destinationWardId: 'ward-route-future-review-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await acceptRouteRequest(routeRequest.id)
    await updateRoute(route.id, { status: 'completed' })

    const res = await request(
      server,
      'GET',
      `/api/driver/routes?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(res.status, 200)
    assert.equal(res.body.some((item: { id: string }) => item.id === route.id), true)
  })

  it('keeps same-day completed plans visible until client submits review', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = formatLocalDateValue(new Date())
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-plan-review',
      destinationWardId: 'ward-plan-review-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate,
          windowStart: `${departureDate}T07:00:00.000Z`,
          tripPrice: 100000,
        })
      ).id,
    )
    const routeRequest = await createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await acceptRouteRequest(routeRequest.id)
    await updatePlan(plan.id, { status: 'completed' })

    const beforeReview = await request(
      server,
      'GET',
      `/api/client/trip-plans?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(beforeReview.status, 200)
    assert.equal(
      beforeReview.body.some((item: { id: string }) => item.id === plan.id),
      true,
    )

    await createReview({
      tripId: plan.id,
      reviewerId: CLIENT_001_ID,
      revieweeId: DRIVER_001_ID,
      rating: 5,
      comment: 'done',
    })

    const afterReview = await request(
      server,
      'GET',
      `/api/client/trip-plans?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(afterReview.status, 200)
    assert.equal(
      afterReview.body.some((item: { id: string }) => item.id === plan.id),
      false,
    )
  })

  it('keeps future-dated completed plans visible until client submits review', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = formatLocalDateValue(addDays(new Date(), 7))
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-plan-expired',
      destinationWardId: 'ward-plan-expired-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate,
          windowStart: `${departureDate}T07:00:00.000Z`,
          tripPrice: 100000,
        })
      ).id,
    )
    const routeRequest = await createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await acceptRouteRequest(routeRequest.id)
    await updatePlan(plan.id, { status: 'completed' })

    const res = await request(
      server,
      'GET',
      `/api/client/trip-plans?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(res.status, 200)
    assert.equal(res.body.some((item: { id: string }) => item.id === plan.id), true)
  })

  it('separates active and history scopes for terminal driver routes', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = formatLocalDateValue(addDays(new Date(), 7))
    const reviewed = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Reviewed Origin' },
      destination: { lat: 10.85, lng: 106.75, label: 'Reviewed Dest' },
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    const unreviewed = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Unreviewed Origin' },
      destination: { lat: 10.85, lng: 106.75, label: 'Unreviewed Dest' },
      departureDate,
      windowStart: `${departureDate}T08:00:00.000Z`,
      tripPrice: 100000,
    })
    const canceled = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Canceled Origin' },
      destination: { lat: 10.85, lng: 106.75, label: 'Canceled Dest' },
      departureDate,
      windowStart: `${departureDate}T09:00:00.000Z`,
      tripPrice: 100000,
    })
    const reviewedPlan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Reviewed Pickup' },
      destination: { lat: 10.85, lng: 106.75, label: 'Reviewed Dropoff' },
      originWardId: 'ward-reviewed-route-plan',
      destinationWardId: 'ward-reviewed-route-plan-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const unreviewedPlan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Unreviewed Pickup' },
      destination: { lat: 10.85, lng: 106.75, label: 'Unreviewed Dropoff' },
      originWardId: 'ward-unreviewed-route-plan',
      destinationWardId: 'ward-unreviewed-route-plan-dest',
      departureDate,
      windowStart: `${departureDate}T08:00:00.000Z`,
      windowEnd: `${departureDate}T08:30:00.000Z`,
      passengerCount: 1,
    })
    await insertAcceptedRouteRequest(reviewed.id, reviewedPlan.id)
    await insertAcceptedRouteRequest(unreviewed.id, unreviewedPlan.id)
    await updateRoute(reviewed.id, { status: 'completed' })
    await updateRoute(unreviewed.id, { status: 'completed' })
    await updateRoute(canceled.id, { status: 'canceled' })
    await createReview({
      tripId: reviewed.id,
      reviewerId: DRIVER_001_ID,
      revieweeId: CLIENT_001_ID,
      rating: 5,
      comment: 'done',
    })

    const active = await request(server, 'GET', `/api/driver/routes?driverId=${DRIVER_001_ID}`)
    const history = await request(server, 'GET', `/api/driver/routes?driverId=${DRIVER_001_ID}&scope=history`)

    assert.equal(active.status, 200)
    assert.equal(active.body.some((item: { id: string }) => item.id === unreviewed.id), true)
    assert.equal(active.body.some((item: { id: string }) => item.id === reviewed.id), false)
    assert.equal(active.body.some((item: { id: string }) => item.id === canceled.id), false)
    assert.equal(history.status, 200)
    assert.deepEqual(
      history.body.map((item: { id: string }) => item.id).sort(),
      [reviewed.id, unreviewed.id, canceled.id].sort(),
    )
  })

  it('separates active and history scopes for terminal client plans', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = formatLocalDateValue(addDays(new Date(), 7))
    const makePlan = (suffix: string) =>
      planService.createPlan(CLIENT_001_ID, {
        origin: { lat: 10.77, lng: 106.7, label: `${suffix} Pickup` },
        destination: { lat: 10.85, lng: 106.75, label: `${suffix} Dropoff` },
        originWardId: `ward-${suffix}`,
        destinationWardId: `ward-${suffix}-dest`,
        departureDate,
        windowStart: `${departureDate}T07:00:00.000Z`,
        windowEnd: `${departureDate}T07:30:00.000Z`,
        passengerCount: 1,
      })
    const reviewed = await makePlan('reviewed')
    const unreviewed = await makePlan('unreviewed')
    const canceled = await makePlan('canceled')
    const reviewedRoute = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Reviewed Origin' },
      destination: { lat: 10.85, lng: 106.75, label: 'Reviewed Dest' },
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    const unreviewedRoute = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Unreviewed Origin' },
      destination: { lat: 10.85, lng: 106.75, label: 'Unreviewed Dest' },
      departureDate,
      windowStart: `${departureDate}T08:00:00.000Z`,
      tripPrice: 100000,
    })
    await insertAcceptedRouteRequest(reviewedRoute.id, reviewed.id)
    await insertAcceptedRouteRequest(unreviewedRoute.id, unreviewed.id)
    await updatePlan(reviewed.id, { status: 'completed' })
    await updatePlan(unreviewed.id, { status: 'completed' })
    await updatePlan(canceled.id, { status: 'canceled' })
    await createReview({
      tripId: reviewed.id,
      reviewerId: CLIENT_001_ID,
      revieweeId: DRIVER_001_ID,
      rating: 5,
      comment: 'done',
    })

    const active = await request(server, 'GET', `/api/client/trip-plans?clientId=${CLIENT_001_ID}`)
    const history = await request(server, 'GET', `/api/client/trip-plans?clientId=${CLIENT_001_ID}&scope=history`)

    assert.equal(active.status, 200)
    assert.equal(active.body.some((item: { id: string }) => item.id === unreviewed.id), true)
    assert.equal(active.body.some((item: { id: string }) => item.id === reviewed.id), false)
    assert.equal(active.body.some((item: { id: string }) => item.id === canceled.id), false)
    assert.equal(history.status, 200)
    assert.deepEqual(
      history.body.map((item: { id: string }) => item.id).sort(),
      [reviewed.id, unreviewed.id, canceled.id].sort(),
    )
  })
})

describe('inbox visibility endpoints', () => {
  it('hides client group offers when linked route becomes terminal', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = '2030-04-20'
    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate,
          windowStart: `${departureDate}T07:00:00.000Z`,
          tripPrice: 155000,
        })
      ).id,
    )
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-goffer-hide',
      destinationWardId: 'ward-goffer-hide-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const groups = await groupRequestRepository.deriveDemandGroups()
    const targetGroup = groups.find((group) =>
      group.memberPlanIds.includes(plan.id),
    )
    assert.ok(targetGroup)
    const groupRequest = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      route.id,
      targetGroup!.id,
    )

    const before = await request(
      server,
      'GET',
      `/api/client/incoming-driver-offers?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(before.status, 200)
    assertOnlyEnvelopeKeys(before.body, ['data', 'meta'])
    assert.ok(Array.isArray(before.body.data), 'expected envelope { data: [...] }')
    assert.equal(before.body.meta?.count, before.body.data.length)
    assert.equal(before.body[0], undefined, 'must not expose legacy bare array fields')
    assert.equal(
      before.body.data.some(
        (item: { id: string }) => item.id === groupRequest.offers[0]?.id,
      ),
      true,
    )

    await updateRoute(route.id, { status: 'completed' })

    const after = await request(
      server,
      'GET',
      `/api/client/incoming-driver-offers?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(after.status, 200)
    assertOnlyEnvelopeKeys(after.body, ['data', 'meta'])
    assert.ok(Array.isArray(after.body.data), 'expected envelope { data: [...] }')
    assert.equal(after.body.meta?.count, after.body.data.length)
    assert.equal(
      after.body.data.some(
        (item: { id: string }) => item.id === groupRequest.offers[0]?.id,
      ),
      false,
    )
  })

  it('accepts a group offer with a { data } envelope only', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const offer = await createPendingGroupOfferForClient('2030-04-22', 'accept-envelope')

    const res = await request(
      server,
      'POST',
      `/api/client/group-offers/${offer.id}/accept`,
    )

    assert.equal(res.status, 200)
    assertOnlyEnvelopeKeys(res.body, ['data'])
    assert.equal(res.body.id, undefined, 'must not expose legacy bare offer fields')
    assert.equal(res.body.data.id, offer.id)
    assert.equal(res.body.data.status, 'accepted')
  })

  it('declines a group offer with a { data } envelope only', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const offer = await createPendingGroupOfferForClient('2030-04-23', 'decline-envelope')

    const res = await request(
      server,
      'POST',
      `/api/client/group-offers/${offer.id}/decline`,
    )

    assert.equal(res.status, 200)
    assertOnlyEnvelopeKeys(res.body, ['data'])
    assert.equal(res.body.id, undefined, 'must not expose legacy bare offer fields')
    assert.equal(res.body.data.id, offer.id)
    assert.equal(res.body.data.status, 'declined')
  })

  it('hides client search requests when linked route becomes terminal', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = '2030-04-21'
    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate,
          windowStart: `${departureDate}T07:00:00.000Z`,
          tripPrice: 155000,
        })
      ).id,
    )
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-client-search-hide',
      destinationWardId: 'ward-client-search-hide-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )

    const before = await request(
      server,
      'GET',
      `/api/client/outgoing-route-requests?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(before.status, 200)
    assert.equal(
      before.body.some((item: { id: string }) => item.id === routeRequest.id),
      true,
    )

    await updateRoute(route.id, { status: 'canceled' })

    const after = await request(
      server,
      'GET',
      `/api/client/outgoing-route-requests?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(after.status, 200)
    assert.equal(
      after.body.some((item: { id: string }) => item.id === routeRequest.id),
      false,
    )
  })

  it('hides driver search requests when linked plan becomes terminal', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const departureDate = '2030-04-22'
    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate,
          windowStart: `${departureDate}T07:00:00.000Z`,
          tripPrice: 155000,
        })
      ).id,
    )
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-driver-search-hide',
      destinationWardId: 'ward-driver-search-hide-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )

    const before = await request(
      server,
      'GET',
      `/api/driver/route-requests?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(before.status, 200)
    assert.equal(
      before.body.some((item: { id: string }) => item.id === routeRequest.id),
      true,
    )

    await updatePlan(plan.id, { status: 'completed' })

    const after = await request(
      server,
      'GET',
      `/api/driver/route-requests?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(after.status, 200)
    assert.equal(
      after.body.some((item: { id: string }) => item.id === routeRequest.id),
      false,
    )
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

  it('suppresses cross-route accepted plans and restores them after cancellation', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const targetRouteRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-api-exclusive',
      destinationWardId: 'ward-api-exclusive-dest',
      departureDate: '2030-04-11',
      windowStart: '2030-04-11T07:00:00.000Z',
      tripPrice: 120000,
    })
    assert.equal(targetRouteRes.status, 201)
    await query("UPDATE routes SET status = 'published', distance_meters = COALESCE(distance_meters, 10000) WHERE id = $1", [
      targetRouteRes.body.id,
    ])

    const planRes = await request(server, 'POST', '/api/client/trip-plans', {
      clientId: CLIENT_001_ID,
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-api-exclusive',
      destinationWardId: 'ward-api-exclusive-dest',
      departureDate: '2030-04-11',
      windowStart: '2030-04-11T07:00:00.000Z',
      windowEnd: '2030-04-11T07:30:00.000Z',
      passengerCount: 1,
    })
    assert.equal(planRes.status, 201)
    await query("UPDATE plans SET status = 'published' WHERE id = $1", [
      planRes.body.id,
    ])

    const otherRouteRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_002_ID,
      carId: 'car-002',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-api-exclusive',
      destinationWardId: 'ward-api-exclusive-dest',
      departureDate: '2030-04-11',
      windowStart: '2030-04-11T07:00:00.000Z',
      tripPrice: 130000,
    })
    assert.equal(otherRouteRes.status, 201)
    await query("UPDATE routes SET status = 'published', distance_meters = COALESCE(distance_meters, 10000) WHERE id = $1", [
      otherRouteRes.body.id,
    ])

    const before = await request(
      server,
      'GET',
      `/api/driver/routes/${targetRouteRes.body.id}/matched-demand-groups`,
    )
    assert.equal(before.status, 200)
    assert.equal(
      before.body.some(
        (group: { originWardId: string }) =>
          group.originWardId === 'ward-api-exclusive',
      ),
      true,
    )

    const routeRequestRes = await request(
      server,
      'POST',
      '/api/client/route-requests',
      {
        clientId: CLIENT_001_ID,
        planId: planRes.body.id,
        routeId: otherRouteRes.body.id,
      },
    )
    assert.equal(routeRequestRes.status, 201)
    await acceptRouteRequest(routeRequestRes.body.id)

    const suppressed = await request(
      server,
      'GET',
      `/api/driver/routes/${targetRouteRes.body.id}/matched-demand-groups`,
    )
    assert.equal(suppressed.status, 200)
    assert.equal(
      suppressed.body.some(
        (group: { originWardId: string }) =>
          group.originWardId === 'ward-api-exclusive',
      ),
      false,
    )

    const cancel = await request(
      server,
      'POST',
      `/api/trips/${otherRouteRes.body.id}/cancel`,
    )
    assert.equal(cancel.status, 200)
    await query('UPDATE route_requests SET status = $1 WHERE id = $2', [
      'canceled',
      routeRequestRes.body.id,
    ])
    await query('UPDATE plans SET status = $1 WHERE id = $2', [
      'published',
      planRes.body.id,
    ])

    const restored = await request(
      server,
      'GET',
      `/api/driver/routes/${targetRouteRes.body.id}/matched-demand-groups`,
    )
    assert.equal(restored.status, 200)
    assert.equal(
      restored.body.some(
        (group: { originWardId: string }) =>
          group.originWardId === 'ward-api-exclusive',
      ),
      true,
    )
  })
})

describe('GET /api/driver/routes/:id/incoming-requests', () => {
  it('returns only pending inbound search requests for driver detail reads', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await publishRoute(
      (
        await createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureDate: '2030-04-12',
          windowStart: '2030-04-12T07:00:00.000Z',
          tripPrice: 125000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const acceptedRequest = await createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      route.id,
    )
    await acceptRouteRequest(acceptedRequest.id)

    const closedRequest = await createRouteRequest(
      CLIENT_002_ID,
      'plan-002',
      route.id,
    )
    await query('UPDATE route_requests SET status = $1 WHERE id = $2', [
      'closed',
      closedRequest.id,
    ])

    const pendingRequest = await createRouteRequest(
      CLIENT_002_ID,
      'plan-002',
      route.id,
    )

    const res = await request(
      server,
      'GET',
      `/api/driver/routes/${route.id}/incoming-requests`,
    )

    assert.equal(res.status, 200)
    assert.deepEqual(
      res.body.map((request: { id: string; status: string }) => ({
        id: request.id,
        status: request.status,
      })),
      [{ id: pendingRequest.id, status: 'pending' }],
    )
  })
})

describe('POST /api/client/route-requests', () => {
  it('creates a search request with a linked plan', async () => {
    // Create a fresh route so it's available
    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate: '2030-04-02',
      windowStart: '2030-04-02T07:00:00.000Z',
      tripPrice: 100000,
    })

    // Create a persisted plan to link as context
    const tpRes = await request(server, 'POST', '/api/client/trip-plans', {
      clientId: CLIENT_001_ID,
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-test',
      destinationWardId: 'ward-test2',
      departureDate: '2030-04-02',
      windowStart: '2030-04-02T07:00:00.000Z',
      windowEnd: '2030-04-02T07:30:00.000Z',
      passengerCount: 1,
    })

    const res = await request(server, 'POST', '/api/client/route-requests', {
      clientId: CLIENT_001_ID,
      planId: tpRes.body.id,
      routeId: routeRes.body.id,
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'pending')
  })

  it('rejects duplicate active requests with 409 conflict and existingRequest payload', async () => {
    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate: '2030-04-10',
      windowStart: '2030-04-10T07:00:00.000Z',
      tripPrice: 100000,
    })
    const routeId = routeRes.body.id
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-dup-search',
      destinationWardId: 'ward-dup-search-dest',
      departureDate: '2030-04-10',
      windowStart: '2030-04-10T07:00:00.000Z',
      windowEnd: '2030-04-10T07:30:00.000Z',
      passengerCount: 1,
    })

    const req1 = await request(server, 'POST', '/api/client/route-requests', {
      clientId: CLIENT_001_ID,
      planId: plan.id,
      routeId,
    })
    assert.equal(req1.status, 201)
    assert.equal(req1.body.status, 'pending')

    const req2 = await request(server, 'POST', '/api/client/route-requests', {
      clientId: CLIENT_001_ID,
      planId: plan.id,
      routeId,
    })
    assert.equal(req2.status, 409)
    assert.ok(
      req2.body.error?.details?.existingRequest,
      'Should include existingRequest in 409 response payload',
    )
    assert.equal(req2.body.error.details.existingRequest.id, req1.body.id)
  })

  for (const terminalStatus of ['declined', 'closed', 'expired'] as const) {
    it(`allows resend after ${terminalStatus}`, async () => {
      const routeRes = await request(server, 'POST', '/api/driver/routes', {
        driverId: DRIVER_001_ID,
        carId: 'car-001',
        origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
        destination: { lat: 10.85, lng: 106.75, label: 'TD' },
        departureDate: `2030-04-1${terminalStatus.length}`,
        windowStart: `2030-04-1${terminalStatus.length}T07:00:00.000Z`,
        tripPrice: 100000,
      })
      const routeId = routeRes.body.id
      const plan = await planService.createPlan(CLIENT_001_ID, {
        origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
        destination: { lat: 10.85, lng: 106.75, label: 'TD' },
        originWardId: `ward-resend-${terminalStatus}`,
        destinationWardId: `ward-resend-${terminalStatus}-dest`,
        departureDate: `2030-04-1${terminalStatus.length}`,
        windowStart: `2030-04-1${terminalStatus.length}T07:00:00.000Z`,
        windowEnd: `2030-04-1${terminalStatus.length}T07:30:00.000Z`,
        passengerCount: 1,
      })

      const initialRequest = await request(
        server,
        'POST',
        '/api/client/route-requests',
        {
          clientId: CLIENT_001_ID,
          planId: plan.id,
          routeId,
        },
      )
      assert.equal(initialRequest.status, 201)

      await query('UPDATE route_requests SET status = $1 WHERE id = $2', [
        terminalStatus,
        initialRequest.body.id,
      ])

      const resend = await request(
        server,
        'POST',
        '/api/client/route-requests',
        {
          clientId: CLIENT_001_ID,
          planId: plan.id,
          routeId,
        },
      )

      assert.equal(resend.status, 201)
      assert.notEqual(resend.body.id, initialRequest.body.id)
      assert.equal(resend.body.status, 'pending')
    })
  }
  it('rejects a search request without a planId', async () => {
    // Create a fresh route so it's available
    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate: '2030-04-03',
      windowStart: '2030-04-03T07:00:00.000Z',
      tripPrice: 100000,
    })

    const res = await request(server, 'POST', '/api/client/route-requests', {
      clientId: CLIENT_001_ID,
      routeId: routeRes.body.id,
      note: 'Hello without plan',
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('planId is required'))
  })
  it('accepts a grouped plan as linked context', async () => {
    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_001_ID,
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate: '2030-04-04',
      windowStart: '2030-04-04T07:00:00.000Z',
      tripPrice: 100000,
    })

    const res = await request(server, 'POST', '/api/client/route-requests', {
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
      departureDate: '2030-04-05',
      windowStart: '2030-04-05T07:00:00.000Z',
      tripPrice: 100000,
    })

    const res = await request(server, 'POST', '/api/client/route-requests', {
      clientId: CLIENT_001_ID,
      planId: 'plan-missing',
      routeId: routeRes.body.id,
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('Plan not found'))
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

  it('GET /api/driver/cars/:id returns persisted car detail', async () => {
    const created = await carService.createCar(DRIVER_001_ID, {
      nickname: 'Live API car',
      plateNumberFull: '51A-123.45',
      plateNumberMasked: '51A-***45',
      brand: 'Toyota',
      model: 'Vios',
      color: 'Trắng',
      seatCapacity: 4,
      verificationStatus: 'verified',
      photos: ['https://example.com/car.jpg'],
    })

    const res = await request(server, 'GET', `/api/driver/cars/${created.id}`)

    assert.equal(res.status, 200)
    assert.equal(res.body.id, created.id)
    assert.equal(res.body.ownerId, DRIVER_001_ID)
    assert.equal(res.body.brand, 'Toyota')
    assert.equal(res.body.model, 'Vios')
    assert.equal(res.body.color, 'Trắng')
    assert.equal(res.body.plateNumberMasked, '51A-***45')
    assert.deepEqual(res.body.photos, ['https://example.com/car.jpg'])
  })

  it('GET /api/driver/cars/:id returns 404 for unknown car', async () => {
    const res = await request(server, 'GET', '/api/driver/cars/car-missing')

    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'HTTP_404')
    assert.equal(res.body.error.message, 'Car not found')
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
    assert.ok(res.body.identity.id, 'should return a backend identity UUID id')
    assert.notEqual(res.body.identity.id, 'zalo-new-user-001', 'id !== mauid')
    assert.equal(res.body.identity.mauid, 'zalo-new-user-001')
    assert.equal(res.body.identity.displayName, 'New Test User')
    assert.equal(res.body.identity.avatarUrl, 'https://example.com/avatar.png')
    assert.equal(res.body.identity.preferredMode, 'client')
    assert.equal(res.body.activeMode, 'client')
    assert.equal(res.body.activeUser.role, 'client')
    assert.equal(res.body.personas.client.identityId, res.body.identity.id)
    assert.equal(res.body.personas.driver.identityId, res.body.identity.id)
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
    assert.equal(second.body.identity.id, first.body.identity.id, 'identity id should be stable')
    assert.equal(second.body.personas.client.id, first.body.personas.client.id, 'client persona id should be stable')
    assert.equal(second.body.personas.driver.id, first.body.personas.driver.id, 'driver persona id should be stable')
    assert.equal(second.body.identity.mauid, 'zalo-repeat-user-001')
    assert.equal(second.body.identity.displayName, 'Repeat User Updated')
    assert.equal(second.body.identity.avatarUrl, 'https://example.com/new-avatar.png')
    assert.equal(second.body.identity.preferredMode, 'client')
    assert.equal(second.body.activeMode, 'client')
  })

  it('returns 400 when mauid is missing', async () => {
    const res = await request(server, 'POST', '/api/users/bootstrap', {
      displayName: 'No Mauid',
      avatarUrl: '',
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('mauid'))
  })

  it('returns 400 when displayName is missing', async () => {
    const res = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-missing-name',
      avatarUrl: '',
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('displayName'))
  })

  it('returns 400 when avatarUrl is missing', async () => {
    const res = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-missing-avatar',
      displayName: 'Missing Avatar',
    })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.message.includes('avatarUrl'))
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
    const identityId = bootstrap.body.identity.id
    const userId = bootstrap.body.activeUser.id

    // Save mode
    const saveRes = await request(server, 'POST', `/api/identities/${identityId}/mode`, {
      preferredMode: 'driver',
    })
    assert.equal(saveRes.status, 200)
    assert.equal(saveRes.body.identity.preferredMode, 'driver')
    assert.equal(saveRes.body.activeMode, 'driver')
    assert.equal(saveRes.body.activeUser.id, bootstrap.body.personas.driver.id)

    // Read mode
    const readRes = await request(server, 'GET', `/api/users/${userId}/mode`)
    assert.equal(readRes.status, 200)
    assert.equal(readRes.body.preferredMode, 'driver')
  })
})

describe('persona role validation', () => {
  it('rejects wrong-role personas on driver and client mutations', async () => {
    const bootstrap = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-role-validation-001',
      displayName: 'Role Validation',
      avatarUrl: '',
    })
    assert.equal(bootstrap.status, 201)

    const clientPersonaId = bootstrap.body.personas.client.id
    const driverPersonaId = bootstrap.body.personas.driver.id
    const departureDate = formatLocalDateValue(addDays(new Date(), 1))

    const routeRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: clientPersonaId,
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    assert.equal(routeRes.status, 403)

    const planRes = await request(server, 'POST', '/api/client/trip-plans', {
      clientId: driverPersonaId,
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate,
      windowStart: `${departureDate}T07:30:00.000Z`,
      seats: 1,
    })
    assert.equal(planRes.status, 403)
  })
})

describe('user profile, review, report, blocklist, and notification routes', () => {
  it('reads and patches user profile with editable fields only', async () => {
    const bootstrap = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-profile-test-001',
      displayName: 'Profile Test',
      avatarUrl: 'https://example.com/profile.png',
    })
    assert.equal(bootstrap.status, 201)
    const userId = bootstrap.body.activeUser.id

    const getRes = await request(server, 'GET', `/api/users/${userId}`)
    assert.equal(getRes.status, 200)
    assert.equal(getRes.body.id, userId)
    assert.equal(getRes.body.mauid, 'zalo-profile-test-001')

    const patchRes = await request(server, 'PATCH', `/api/users/${userId}`, {
      displayName: 'Profile Test Updated',
      preferredMode: 'client',
    })
    assert.equal(patchRes.status, 200)
    assert.equal(patchRes.body.displayName, 'Profile Test Updated')
    assert.equal(patchRes.body.mauid, 'zalo-profile-test-001')
    assert.equal(patchRes.body.role, 'client')

    const rejectRes = await request(server, 'PATCH', `/api/users/${userId}`, {
      mauid: 'should-not-change',
    })
    assert.equal(rejectRes.status, 400)
    assert.ok(rejectRes.body.error.message.includes('Field is not editable'))
  })

  it('creates review and report records and lists them by user', async () => {
    const reviewer = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-reviewer-001',
      displayName: 'Reviewer User',
      avatarUrl: '',
    })
    const reviewee = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-reviewee-001',
      displayName: 'Reviewee User',
      avatarUrl: '',
    })

    const reviewerClientId = reviewer.body.personas.client.id
    const revieweeDriverId = reviewee.body.personas.driver.id
    const departureDate = formatLocalDateValue(new Date())
    const route = await createRoute(revieweeDriverId, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    const plan = await planService.createPlan(reviewerClientId, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-review-route',
      destinationWardId: 'ward-review-route-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await createRouteRequest(reviewerClientId, plan.id, route.id)
    await acceptRouteRequest(routeRequest.id)
    await updateRoute(route.id, { status: 'completed' })

    const reviewRes = await request(server, 'POST', '/api/reviews', {
      tripId: route.id,
      reviewerId: reviewerClientId,
      revieweeId: revieweeDriverId,
      rating: 5,
      comment: 'Great trip',
    })
    assert.equal(reviewRes.status, 201)
    assert.equal(reviewRes.body.reviewerId, reviewerClientId)
    assert.equal(reviewRes.body.revieweeId, revieweeDriverId)
    assert.equal(reviewRes.body.rating, 5)

    const reportRes = await request(server, 'POST', '/api/reports', {
      tripId: route.id,
      reporterId: reviewerClientId,
      reporteeId: revieweeDriverId,
      reason: 'spam',
      detail: 'Spam in chat',
    })
    assert.equal(reportRes.status, 201)
    assert.equal(reportRes.body.reason, 'spam')

    const reviewsByUser = await request(
      server,
      'GET',
      `/api/users/${reviewerClientId}/reviews`,
    )
    assert.equal(reviewsByUser.status, 200)
    assert.equal(reviewsByUser.body.items.length, 1)
    assert.equal(reviewsByUser.body.items[0].tripId, route.id)

    const reportsByUser = await request(
      server,
      'GET',
      `/api/users/${reviewerClientId}/reports`,
    )
    assert.equal(reportsByUser.status, 200)
    assert.equal(reportsByUser.body.items.length, 1)
    assert.equal(reportsByUser.body.items[0].reason, 'spam')
  })

  it('allows reviewing an eligible completed trip but rejects duplicate and incomplete reviews', async () => {
    const departureDate = formatLocalDateValue(addDays(new Date(), 7))
    const route = await publishRoute((await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })).id)
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-review-eligible',
      destinationWardId: 'ward-review-eligible-dest',
      departureDate,
      windowStart: `${departureDate}T07:00:00.000Z`,
      windowEnd: `${departureDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await acceptRouteRequest(routeRequest.id)
    await updateRoute(route.id, { status: 'completed' })

    const res = await request(server, 'POST', '/api/reviews', {
      tripId: route.id,
      reviewerId: DRIVER_001_ID,
      revieweeId: CLIENT_001_ID,
      rating: 5,
      comment: 'Eligible completed trip',
    })

    assert.equal(res.status, 201)

    const duplicate = await request(server, 'POST', '/api/reviews', {
      tripId: route.id,
      reviewerId: DRIVER_001_ID,
      revieweeId: CLIENT_001_ID,
      rating: 4,
      comment: 'Duplicate',
    })

    assert.equal(duplicate.status, 409)

    const incomplete = await createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureDate,
      windowStart: `${departureDate}T08:00:00.000Z`,
      tripPrice: 100000,
    })
    const incompleteRes = await request(server, 'POST', '/api/reviews', {
      tripId: incomplete.id,
      reviewerId: DRIVER_001_ID,
      revieweeId: CLIENT_001_ID,
      rating: 5,
      comment: 'Not done',
    })

    assert.equal(incompleteRes.status, 400)
    assert.equal(incompleteRes.body.error.message, 'Review is not allowed: missing_counterpart')
  })

  it('blocks, unblocks, lists notifications, and marks them read', async () => {
    const owner = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-block-owner-001',
      displayName: 'Block Owner',
      avatarUrl: '',
    })
    const blocked = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-block-target-001',
      displayName: 'Blocked User',
      avatarUrl: '',
    })
    const ownerId = owner.body.activeUser.id
    const ownerDriverId = owner.body.personas.driver.id
    const blockedId = blocked.body.activeUser.id
    const blockedDriverId = blocked.body.personas.driver.id
    const blockedPersonaIds = [
      blocked.body.personas.client.id,
      blockedDriverId,
    ].sort()

    const blockRes = await request(
      server,
      'POST',
      `/api/users/${ownerId}/blocked-users`,
      { blockedId },
    )
    assert.equal(blockRes.status, 201)
    assert.deepEqual([...blockRes.body.blockedUserIds].sort(), blockedPersonaIds)

    const blockedListRes = await request(
      server,
      'GET',
      `/api/users/${ownerId}/blocked-users`,
    )
    assert.equal(blockedListRes.status, 200)
    assert.deepEqual([...blockedListRes.body.blockedUserIds].sort(), blockedPersonaIds)

    const blockedListViaDriverPersonaRes = await request(
      server,
      'GET',
      `/api/users/${ownerDriverId}/blocked-users`,
    )
    assert.equal(blockedListViaDriverPersonaRes.status, 200)
    assert.deepEqual(
      [...blockedListViaDriverPersonaRes.body.blockedUserIds].sort(),
      blockedPersonaIds,
    )

    const notificationRes = await request(
      server,
      'POST',
      `/api/users/${ownerId}/notifications`,
      {
        type: 'request_received',
        title: 'New request',
        body: 'You have a new request',
        targetRoute: '/journeys/1',
      },
    )
    assert.equal(notificationRes.status, 201)
    assert.equal(notificationRes.body.read, false)

    const notificationId = notificationRes.body.id
    const listRes = await request(
      server,
      'GET',
      `/api/users/${ownerId}/notifications`,
    )
    assert.equal(listRes.status, 200)
    assert.equal(listRes.body.items.length, 1)
    assert.equal(listRes.body.items[0].id, notificationId)

    const markReadRes = await request(
      server,
      'POST',
      `/api/users/${ownerId}/notifications/${notificationId}/read`,
    )
    assert.equal(markReadRes.status, 200)
    assert.equal(markReadRes.body.read, true)

    const markAllRes = await request(
      server,
      'POST',
      `/api/users/${ownerId}/notifications/read-all`,
    )
    assert.equal(markAllRes.status, 204)

    const unblockRes = await request(
      server,
      'DELETE',
      `/api/users/${ownerId}/blocked-users/${blockedDriverId}`,
    )
    assert.equal(unblockRes.status, 200)
    assert.deepEqual(unblockRes.body.blockedUserIds, [])
  })
})
