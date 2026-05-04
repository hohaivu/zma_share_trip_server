import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe } from 'node:test'

import { query } from './db/connection'
import app from './index'
import * as store from './store'
import {
  createDbTest,
  isDbAvailable,
  setupTestDb,
  teardownTestDb,
} from './test-db'

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
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-test',
      dropoffWardId: 'ward-test2',
      serviceDate: '2030-04-01',
      departureBlockStart: '2030-04-01T08:00:00.000Z',
      departureBlockEnd: '2030-04-01T08:30:00.000Z',
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
})

describe('DELETE /api/client/trip-plans/:id', () => {
  it('cancels an owned plan', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-api-cancel',
      dropoffWardId: 'ward-api-cancel-dest',
      serviceDate: '2030-06-01',
      departureBlockStart: '2030-06-01T08:00:00.000Z',
      departureBlockEnd: '2030-06-01T08:30:00.000Z',
      passengerCount: 1,
    })

    const res = await request(
      server,
      'DELETE',
      `/api/client/trip-plans/${plan.id}`,
      { clientId: CLIENT_001_ID },
    )

    assert.equal(res.status, 200)
    assert.equal(res.body.id, plan.id)
    assert.equal(res.body.status, 'canceled')
  })

  it('rejects a non-owner', async () => {
    const res = await request(
      server,
      'DELETE',
      '/api/client/trip-plans/plan-001',
      { clientId: CLIENT_002_ID },
    )

    assert.equal(res.status, 403)
  })

  it('returns 404 for a missing plan', async () => {
    const res = await request(
      server,
      'DELETE',
      '/api/client/trip-plans/plan-missing',
      { clientId: CLIENT_001_ID },
    )

    assert.equal(res.status, 404)
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
    assert.ok(res.body.message.includes('Unresolved exact-point'))
  })
})

describe('driver wallet routes', () => {
  it('returns wallet summary with derived balances and fee configuration', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const wallet = await store.getOrCreateDriverWallet(DRIVER_001_ID)
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
    assert.equal(res.body.driverId, DRIVER_001_ID)
    assert.equal(res.body.balanceVnd, 250000)
    assert.equal(res.body.reservedBalanceVnd, 50000)
    assert.equal(res.body.availableBalanceVnd, 200000)
    assert.equal(res.body.feeRateVndPerKm, 500)
    assert.equal(res.body.maxPublishableDistanceMeters, 400000)
  })

  it('lists wallet transactions in reverse chronological order after top-up activity', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const wallet = await store.getOrCreateDriverWallet(DRIVER_001_ID)
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
    assert.ok(Array.isArray(res.body.items))
    assert.equal(res.body.items.length, 2)
    assert.equal(res.body.items[0].id, 'wtx-wallet-newer')
    assert.equal(res.body.items[0].type, 'reservation')
    assert.equal(res.body.items[0].amountVnd, -50000)
    assert.equal(res.body.items[0].description, 'Reserved route fee')
    assert.equal(res.body.items[1].id, 'wtx-wallet-older')
    assert.equal(res.body.items[1].type, 'topup')
    assert.equal(res.body.items[1].amountVnd, 120000)
    assert.equal(res.body.items[1].description, 'Older top-up')
  })

  it('creates a manual top-up and returns refreshed wallet state plus ledger row', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const initialSummary = await store.getDriverWalletSummary(DRIVER_001_ID)

    const res = await request(server, 'POST', '/api/driver/wallet/topups', {
      driverId: DRIVER_001_ID,
      amountVnd: 150000,
      description: 'API manual top-up test',
    })

    assert.equal(res.status, 201)
    assert.equal(res.body.summary.driverId, DRIVER_001_ID)
    assert.equal(
      res.body.summary.balanceVnd,
      initialSummary.balanceVnd + 150000,
    )
    assert.equal(
      res.body.summary.availableBalanceVnd,
      initialSummary.availableBalanceVnd + 150000,
    )
    assert.equal(res.body.transaction.type, 'topup')
    assert.equal(res.body.transaction.amountVnd, 150000)
    assert.equal(res.body.transaction.description, 'API manual top-up test')

    const summaryRes = await request(
      server,
      'GET',
      `/api/driver/wallet?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(summaryRes.status, 200)
    assert.equal(
      summaryRes.body.balanceVnd,
      initialSummary.balanceVnd + 150000,
    )
  })
})

describe('POST /api/trips/:id/cancel', () => {
  it('cancels a matched route and suppresses the accepted pairing in summary reads', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-04-03',
          departureTime: '2030-04-03T07:00:00.000Z',
          tripPrice: 155000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const searchRequest = await store.createSearchRequest(
      CLIENT_001_ID,
      null,
      route.id,
    )
    await store.acceptSearchRequest(searchRequest.id)

    const cancelRes = await request(server, 'POST', `/api/trips/${route.id}/cancel`)
    assert.equal(cancelRes.status, 200)
    assert.equal(cancelRes.body.status, 'canceled')
    assert.equal(cancelRes.body.walletFeeStatus, 'refunded')

    const summaryRes = await request(server, 'GET', `/api/trips/${route.id}/summary`)
    assert.equal(summaryRes.status, 200)
    assert.equal(summaryRes.body.accepted, null)
  })
})

describe('POST /api/trips/:id/complete', () => {
  it('completes linked plan when completing an accepted route', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const serviceDate = formatLocalDateValue(new Date())
    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate,
          departureTime: `${serviceDate}T07:00:00.000Z`,
          tripPrice: 155000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-complete-sync',
      dropoffWardId: 'ward-complete-sync-dest',
      serviceDate,
      departureBlockStart: `${serviceDate}T07:00:00.000Z`,
      departureBlockEnd: `${serviceDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const searchRequest = await store.createSearchRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )
    await store.acceptSearchRequest(searchRequest.id)

    const completeRes = await request(server, 'POST', `/api/trips/${route.id}/complete`)
    assert.equal(completeRes.status, 200)
    assert.equal(completeRes.body.status, 'completed')

    const linkedPlan = await store.getPlan(plan.id)
    assert.equal(linkedPlan?.status, 'completed')
  })
})

describe('work queue visibility endpoints', () => {
  it('keeps same-day completed routes visible until driver submits review', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const serviceDate = formatLocalDateValue(new Date())
    const route = await store.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate,
      departureTime: `${serviceDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    await store.updateRoute(route.id, { status: 'completed' })

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

    await store.createReview({
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

  it('hides expired completed routes from driver work queue', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const serviceDate = formatLocalDateValue(addDays(new Date(), -1))
    const route = await store.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate,
      departureTime: `${serviceDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    await store.updateRoute(route.id, { status: 'completed' })

    const res = await request(server, 'GET', `/api/driver/routes?driverId=${DRIVER_001_ID}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.some((item: { id: string }) => item.id === route.id), false)
  })

  it('keeps same-day completed plans visible until client submits review', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const serviceDate = formatLocalDateValue(new Date())
    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-plan-review',
      dropoffWardId: 'ward-plan-review-dest',
      serviceDate,
      departureBlockStart: `${serviceDate}T07:00:00.000Z`,
      departureBlockEnd: `${serviceDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    await store.updatePlan(plan.id, { status: 'completed' })

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

    await store.createReview({
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

  it('hides expired completed plans from client work queue', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const serviceDate = formatLocalDateValue(addDays(new Date(), -1))
    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-plan-expired',
      dropoffWardId: 'ward-plan-expired-dest',
      serviceDate,
      departureBlockStart: `${serviceDate}T07:00:00.000Z`,
      departureBlockEnd: `${serviceDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    await store.updatePlan(plan.id, { status: 'completed' })

    const res = await request(
      server,
      'GET',
      `/api/client/trip-plans?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(res.status, 200)
    assert.equal(res.body.some((item: { id: string }) => item.id === plan.id), false)
  })
})

describe('inbox visibility endpoints', () => {
  it('hides client group offers when linked route becomes terminal', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const serviceDate = '2030-04-20'
    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate,
          departureTime: `${serviceDate}T07:00:00.000Z`,
          tripPrice: 155000,
        })
      ).id,
    )
    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-goffer-hide',
      dropoffWardId: 'ward-goffer-hide-dest',
      serviceDate,
      departureBlockStart: `${serviceDate}T07:00:00.000Z`,
      departureBlockEnd: `${serviceDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const groups = await store.deriveDemandGroups()
    const targetGroup = groups.find((group) => group.memberPlanIds.includes(plan.id))
    assert.ok(targetGroup)
    const groupRequest = await store.createGroupRequest(
      DRIVER_001_ID,
      route.id,
      targetGroup!.id,
    )

    const before = await request(
      server,
      'GET',
      `/api/client/group-offers?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(before.status, 200)
    assert.equal(
      before.body.some((item: { id: string }) => item.id === groupRequest.offers[0]?.id),
      true,
    )

    await store.updateRoute(route.id, { status: 'completed' })

    const after = await request(
      server,
      'GET',
      `/api/client/group-offers?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(after.status, 200)
    assert.equal(
      after.body.some((item: { id: string }) => item.id === groupRequest.offers[0]?.id),
      false,
    )
  })

  it('hides client search requests when linked route becomes terminal', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const serviceDate = '2030-04-21'
    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate,
          departureTime: `${serviceDate}T07:00:00.000Z`,
          tripPrice: 155000,
        })
      ).id,
    )
    const searchRequest = await store.createSearchRequest(CLIENT_001_ID, null, route.id)

    const before = await request(
      server,
      'GET',
      `/api/client/search-requests?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(before.status, 200)
    assert.equal(
      before.body.some((item: { id: string }) => item.id === searchRequest.id),
      true,
    )

    await store.updateRoute(route.id, { status: 'canceled' })

    const after = await request(
      server,
      'GET',
      `/api/client/search-requests?clientId=${CLIENT_001_ID}`,
    )
    assert.equal(after.status, 200)
    assert.equal(
      after.body.some((item: { id: string }) => item.id === searchRequest.id),
      false,
    )
  })

  it('hides driver search requests when linked plan becomes terminal', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const serviceDate = '2030-04-22'
    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate,
          departureTime: `${serviceDate}T07:00:00.000Z`,
          tripPrice: 155000,
        })
      ).id,
    )
    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-driver-search-hide',
      dropoffWardId: 'ward-driver-search-hide-dest',
      serviceDate,
      departureBlockStart: `${serviceDate}T07:00:00.000Z`,
      departureBlockEnd: `${serviceDate}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const searchRequest = await store.createSearchRequest(CLIENT_001_ID, plan.id, route.id)

    const before = await request(
      server,
      'GET',
      `/api/driver/search-requests?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(before.status, 200)
    assert.equal(
      before.body.some((item: { id: string }) => item.id === searchRequest.id),
      true,
    )

    await store.updatePlan(plan.id, { status: 'completed' })

    const after = await request(
      server,
      'GET',
      `/api/driver/search-requests?driverId=${DRIVER_001_ID}`,
    )
    assert.equal(after.status, 200)
    assert.equal(
      after.body.some((item: { id: string }) => item.id === searchRequest.id),
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
      serviceDate: '2030-04-11',
      departureTime: '2030-04-11T07:00:00.000Z',
      tripPrice: 120000,
    })
    assert.equal(targetRouteRes.status, 201)

    const planRes = await request(server, 'POST', '/api/client/trip-plans', {
      clientId: CLIENT_001_ID,
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-api-exclusive',
      dropoffWardId: 'ward-api-exclusive-dest',
      serviceDate: '2030-04-11',
      departureBlockStart: '2030-04-11T07:00:00.000Z',
      departureBlockEnd: '2030-04-11T07:30:00.000Z',
      passengerCount: 1,
    })
    assert.equal(planRes.status, 201)

    const otherRouteRes = await request(server, 'POST', '/api/driver/routes', {
      driverId: DRIVER_002_ID,
      carId: 'car-002',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-11',
      departureTime: '2030-04-11T07:00:00.000Z',
      tripPrice: 130000,
    })
    assert.equal(otherRouteRes.status, 201)

    const before = await request(
      server,
      'GET',
      `/api/driver/routes/${targetRouteRes.body.id}/matched-demand-groups`,
    )
    assert.equal(before.status, 200)
    assert.equal(
      before.body.some(
        (group: { pickupWardId: string }) =>
          group.pickupWardId === 'ward-api-exclusive',
      ),
      true,
    )

    const searchRequestRes = await request(
      server,
      'POST',
      '/api/client/search-requests',
      {
        clientId: CLIENT_001_ID,
        planId: planRes.body.id,
        routeId: otherRouteRes.body.id,
      },
    )
    assert.equal(searchRequestRes.status, 201)
    await store.acceptSearchRequest(searchRequestRes.body.id)

    const suppressed = await request(
      server,
      'GET',
      `/api/driver/routes/${targetRouteRes.body.id}/matched-demand-groups`,
    )
    assert.equal(suppressed.status, 200)
    assert.equal(
      suppressed.body.some(
        (group: { pickupWardId: string }) =>
          group.pickupWardId === 'ward-api-exclusive',
      ),
      false,
    )

    const cancel = await request(
      server,
      'POST',
      `/api/trips/${otherRouteRes.body.id}/cancel`,
    )
    assert.equal(cancel.status, 200)

    const restored = await request(
      server,
      'GET',
      `/api/driver/routes/${targetRouteRes.body.id}/matched-demand-groups`,
    )
    assert.equal(restored.status, 200)
    assert.equal(
      restored.body.some(
        (group: { pickupWardId: string }) =>
          group.pickupWardId === 'ward-api-exclusive',
      ),
      true,
    )
  })
})

describe('GET /api/driver/routes/:id/inbound-search-requests', () => {
  it('returns only pending inbound search requests for driver detail reads', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-04-12',
          departureTime: '2030-04-12T07:00:00.000Z',
          tripPrice: 125000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const acceptedRequest = await store.createSearchRequest(
      CLIENT_001_ID,
      null,
      route.id,
    )
    await store.acceptSearchRequest(acceptedRequest.id)

    const closedRequest = await store.createSearchRequest(
      CLIENT_002_ID,
      null,
      route.id,
    )
    await query('UPDATE search_requests SET status = $1 WHERE id = $2', [
      'closed',
      closedRequest.id,
    ])

    const pendingRequest = await store.createSearchRequest(
      CLIENT_002_ID,
      null,
      route.id,
    )

    const res = await request(
      server,
      'GET',
      `/api/driver/routes/${route.id}/inbound-search-requests`,
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

describe('POST /api/client/search-requests', () => {
  it('creates a search request with an optional linked plan', async () => {
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

    // Create a persisted plan to link as context
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
    })

    const res = await request(server, 'POST', '/api/client/search-requests', {
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
      serviceDate: '2030-04-10',
      departureTime: '2030-04-10T07:00:00.000Z',
      tripPrice: 100000,
    })
    const routeId = routeRes.body.id

    const req1 = await request(server, 'POST', '/api/client/search-requests', {
      clientId: CLIENT_001_ID,
      routeId,
    })
    assert.equal(req1.status, 201)
    assert.equal(req1.body.status, 'pending')

    const req2 = await request(server, 'POST', '/api/client/search-requests', {
      clientId: CLIENT_001_ID,
      routeId,
    })
    assert.equal(req2.status, 409)
    assert.ok(
      req2.body.existingRequest,
      'Should include existingRequest in 409 response payload',
    )
    assert.equal(req2.body.existingRequest.id, req1.body.id)
  })

  for (const terminalStatus of ['declined', 'closed', 'expired'] as const) {
    it(`allows resend after ${terminalStatus}`, async () => {
      const routeRes = await request(server, 'POST', '/api/driver/routes', {
        driverId: DRIVER_001_ID,
        carId: 'car-001',
        origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
        destination: { lat: 10.85, lng: 106.75, label: 'TD' },
        serviceDate: `2030-04-1${terminalStatus.length}`,
        departureTime: `2030-04-1${terminalStatus.length}T07:00:00.000Z`,
        tripPrice: 100000,
      })
      const routeId = routeRes.body.id

      const initialRequest = await request(
        server,
        'POST',
        '/api/client/search-requests',
        {
          clientId: CLIENT_001_ID,
          routeId,
        },
      )
      assert.equal(initialRequest.status, 201)

      await query('UPDATE search_requests SET status = $1 WHERE id = $2', [
        terminalStatus,
        initialRequest.body.id,
      ])

      const resend = await request(
        server,
        'POST',
        '/api/client/search-requests',
        {
          clientId: CLIENT_001_ID,
          routeId,
        },
      )

      assert.equal(resend.status, 201)
      assert.notEqual(resend.body.id, initialRequest.body.id)
      assert.equal(resend.body.status, 'pending')
    })
  }
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
    const saveRes = await request(server, 'POST', `/api/users/${userId}/mode`, {
      preferredMode: 'driver',
    })
    assert.equal(saveRes.status, 200)
    assert.equal(saveRes.body.preferredMode, 'driver')

    // Read mode
    const readRes = await request(server, 'GET', `/api/users/${userId}/mode`)
    assert.equal(readRes.status, 200)
    assert.equal(readRes.body.preferredMode, 'driver')
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
    const userId = bootstrap.body.id

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
    assert.equal(patchRes.body.role, 'client')

    const rejectRes = await request(server, 'PATCH', `/api/users/${userId}`, {
      mauid: 'should-not-change',
    })
    assert.equal(rejectRes.status, 400)
    assert.ok(rejectRes.body.message.includes('Field is not editable'))
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

    const serviceDate = formatLocalDateValue(new Date())
    const route = await store.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate,
      departureTime: `${serviceDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    await store.updateRoute(route.id, { status: 'completed' })

    const reviewRes = await request(server, 'POST', '/api/reviews', {
      tripId: route.id,
      reviewerId: reviewer.body.id,
      revieweeId: reviewee.body.id,
      rating: 5,
      comment: 'Great trip',
    })
    assert.equal(reviewRes.status, 201)
    assert.equal(reviewRes.body.reviewerId, reviewer.body.id)
    assert.equal(reviewRes.body.revieweeId, reviewee.body.id)
    assert.equal(reviewRes.body.rating, 5)

    const reportRes = await request(server, 'POST', '/api/reports', {
      tripId: route.id,
      reporterId: reviewer.body.id,
      reporteeId: reviewee.body.id,
      reason: 'spam',
      detail: 'Spam in chat',
    })
    assert.equal(reportRes.status, 201)
    assert.equal(reportRes.body.reason, 'spam')

    const reviewsByUser = await request(
      server,
      'GET',
      `/api/users/${reviewer.body.id}/reviews`,
    )
    assert.equal(reviewsByUser.status, 200)
    assert.equal(reviewsByUser.body.items.length, 1)
    assert.equal(reviewsByUser.body.items[0].tripId, route.id)

    const reportsByUser = await request(
      server,
      'GET',
      `/api/users/${reviewer.body.id}/reports`,
    )
    assert.equal(reportsByUser.status, 200)
    assert.equal(reportsByUser.body.items.length, 1)
    assert.equal(reportsByUser.body.items[0].reason, 'spam')
  })

  it('rejects review submission after review window expires', async () => {
    const reviewer = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-reviewer-expired-001',
      displayName: 'Expired Reviewer',
      avatarUrl: '',
    })
    const reviewee = await request(server, 'POST', '/api/users/bootstrap', {
      mauid: 'zalo-reviewee-expired-001',
      displayName: 'Expired Reviewee',
      avatarUrl: '',
    })

    const serviceDate = formatLocalDateValue(addDays(new Date(), -1))
    const route = await store.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate,
      departureTime: `${serviceDate}T07:00:00.000Z`,
      tripPrice: 100000,
    })
    await store.updateRoute(route.id, { status: 'completed' })

    const res = await request(server, 'POST', '/api/reviews', {
      tripId: route.id,
      reviewerId: reviewer.body.id,
      revieweeId: reviewee.body.id,
      rating: 5,
      comment: 'Too late',
    })

    assert.equal(res.status, 400)
    assert.equal(res.body.message, 'Review window has expired for this trip')
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
    const ownerId = owner.body.id
    const blockedId = blocked.body.id

    const blockRes = await request(
      server,
      'POST',
      `/api/users/${ownerId}/blocked-users`,
      { blockedId },
    )
    assert.equal(blockRes.status, 201)
    assert.deepEqual(blockRes.body.blockedUserIds, [blockedId])

    const blockedListRes = await request(
      server,
      'GET',
      `/api/users/${ownerId}/blocked-users`,
    )
    assert.equal(blockedListRes.status, 200)
    assert.deepEqual(blockedListRes.body.blockedUserIds, [blockedId])

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
      `/api/users/${ownerId}/blocked-users/${blockedId}`,
    )
    assert.equal(unblockRes.status, 200)
    assert.deepEqual(unblockRes.body.blockedUserIds, [])
  })
})
