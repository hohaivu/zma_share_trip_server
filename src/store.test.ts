import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, it as nodeIt } from 'node:test'

import { query } from './db/connection'
import * as matching from './matching'
import * as store from './store'
import { Plan, Route } from './types/entities'
import {
  createDbTest,
  isDbAvailable,
  setupTestDb,
  teardownTestDb,
} from './test-db'

const it = createDbTest('Postgres unavailable for DB-backed store tests')
const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const DRIVER_002_ID = 'a1b2c3d4-0002-4000-8000-000000000002'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'
const CLIENT_002_ID = 'a1b2c3d4-0004-4000-8000-000000000004'
const TERMINAL_SEARCH_REQUEST_STATUSES = [
  'declined',
  'closed',
  'expired',
] as const

// Note: require resets are not trivial in CJS, so we test against the shared
// store instance. Tests should not depend on ordering within a describe block.

before(async () => {
  await setupTestDb()
})

after(async () => {
  await teardownTestDb()
})

// ─── 6.1 deriveDemandGroups ────────────────────────────────────────────────────

describe('deriveDemandGroups', () => {
  it('groups plans by serviceDate + ward pair + departure block', async () => {
    const groups = await store.deriveDemandGroups()
    // Seed has plan-001 and plan-002 sharing the same group key
    const q1TdGroup = groups.find(
      (g) =>
        g.pickupWardId === 'ward-q1-bennghe' &&
        g.dropoffWardId === 'ward-td-binhtho' &&
        g.serviceDate === '2030-03-20',
    )
    assert.ok(q1TdGroup, 'Should find Q1→TD group')
    assert.equal(q1TdGroup.memberCount, 2, 'Multi-member group')
    assert.equal(q1TdGroup.totalPassengerCount, 3, '1 + 2 passengers')
  })

  it('normalizes mixed timezone inputs into identical canonical UTC keys', async () => {
    // Both 14:00+07:00 and 07:00Z represent the same instant and must group together.
    const planA = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10, lng: 106, label: 'A' },
      dropoff: { lat: 11, lng: 106, label: 'B' },
      pickupWardId: 'ward-utc',
      dropoffWardId: 'ward-utc-dest',
      serviceDate: '2030-05-05',
      departureBlockStart: '2030-05-05T14:00:00.000+07:00', // mapped to 07:00Z
      departureBlockEnd: '2030-05-05T14:30:00.000+07:00',
      passengerCount: 1,
    })
    const planB = await store.createPlan(CLIENT_002_ID, {
      pickup: { lat: 10, lng: 106, label: 'A' },
      dropoff: { lat: 11, lng: 106, label: 'B' },
      pickupWardId: 'ward-utc',
      dropoffWardId: 'ward-utc-dest',
      serviceDate: '2030-05-05',
      departureBlockStart: '2030-05-05T07:00:00.000Z',
      departureBlockEnd: '2030-05-05T07:30:00.000Z',
      passengerCount: 2,
    })

    const groups = await store.deriveDemandGroups()
    const utcGroup = groups.find((g) => g.pickupWardId === 'ward-utc')
    assert.ok(utcGroup)
    assert.equal(
      utcGroup.memberCount,
      2,
      'Should group both plans into the same demand group despite different input strings',
    )
    assert.equal(
      utcGroup.departureBlockStart.endsWith('Z'),
      true,
      'Should use explicit canonical UTC Z-time on reads',
    )
  })

  it('creates single-member group for unique ward pair', async () => {
    const groups = await store.deriveDemandGroups()
    const tbGroup = groups.find((g) => g.pickupWardId === 'ward-tb-p15')
    assert.ok(tbGroup, 'Should find Tan Binh group')
    assert.equal(tbGroup.memberCount, 1, 'Single-member group')
    assert.equal(tbGroup.totalPassengerCount, 1)
  })

  it('excludes accepted plans from other routes and recalculates group counts', async () => {
    await setupTestDb()

    const before = await store.deriveDemandGroups()
    const target = before.find(
      (group) =>
        group.pickupWardId === 'ward-q1-bennghe' &&
        group.dropoffWardId === 'ward-td-binhtho' &&
        group.serviceDate === '2030-03-20',
    )
    assert.ok(target)
    assert.equal(target.memberCount, 2)
    assert.equal(target.totalPassengerCount, 3)

    const request = await store.createSearchRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    await store.acceptSearchRequest(request.id)

    const after = await store.deriveDemandGroups()
    const recalculated = after.find((group) => group.id === target.id)
    assert.ok(recalculated)
    assert.equal(recalculated.memberCount, 1)
    assert.equal(recalculated.totalPassengerCount, 2)
    assert.deepEqual(recalculated.memberPlanIds, ['plan-002'])
  })

  it('omits emptied groups from matched-demand results', async () => {
    await setupTestDb()

    const targetRoute = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-03-21',
          departureTime: '2030-03-21T07:00:00.000Z',
          tripPrice: 120000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const acceptedElsewhereRoute = await store.publishRoute(
      (
        await store.createRoute(DRIVER_002_ID, {
          carId: 'car-002',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-03-21',
          departureTime: '2030-03-21T07:00:00.000Z',
          tripPrice: 120000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-exclusive',
      dropoffWardId: 'ward-exclusive-dest',
      serviceDate: '2030-03-21',
      departureBlockStart: '2030-03-21T07:00:00.000Z',
      departureBlockEnd: '2030-03-21T07:30:00.000Z',
      passengerCount: 1,
    })

    const before = await matching.computeMatchedDemandGroups(targetRoute.id)
    assert.equal(
      before.some((group) => group.pickupWardId === 'ward-exclusive'),
      true,
    )

    const request = await store.createSearchRequest(
      CLIENT_001_ID,
      plan.id,
      acceptedElsewhereRoute.id,
    )
    await store.acceptSearchRequest(request.id)

    const after = await matching.computeMatchedDemandGroups(targetRoute.id)
    assert.equal(
      after.some((group) => group.pickupWardId === 'ward-exclusive'),
      false,
    )
  })

  it('persists grouped publish mode for newly created plans', async () => {
    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-persist',
      dropoffWardId: 'ward-persist-dest',
      serviceDate: '2030-05-06',
      departureBlockStart: '2030-05-06T07:00:00.000Z',
      departureBlockEnd: '2030-05-06T07:30:00.000Z',
      passengerCount: 1,
    })

    const persisted = await query(
      'SELECT publish_mode FROM plans WHERE id = $1',
      [plan.id],
    )
    assert.equal(persisted.rows[0]?.publish_mode, 'grouped')
  })

  it('restores plan eligibility after accepted state ends by cancellation', async () => {
    await setupTestDb()

    const initial = await store.deriveDemandGroups()
    const target = initial.find(
      (group) =>
        group.pickupWardId === 'ward-q1-bennghe' &&
        group.dropoffWardId === 'ward-td-binhtho' &&
        group.serviceDate === '2030-03-20',
    )
    assert.ok(target)
    assert.equal(target.memberCount, 2)

    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_002_ID, {
          carId: 'car-002',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-03-20',
          departureTime: '2030-03-20T07:00:00.000Z',
          tripPrice: 99000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const request = await store.createSearchRequest(
      CLIENT_001_ID,
      'plan-001',
      route.id,
    )
    await store.acceptSearchRequest(request.id)

    const suppressed = await store.deriveDemandGroups()
    const suppressedTarget = suppressed.find((group) => group.id === target.id)
    assert.ok(suppressedTarget)
    assert.equal(suppressedTarget.memberCount, 1)

    await store.cancelTrip(route.id)

    const restored = await store.deriveDemandGroups()
    const restoredTarget = restored.find((group) => group.id === target.id)
    assert.ok(restoredTarget)
    assert.equal(restoredTarget.memberCount, 2)
    assert.equal(restoredTarget.totalPassengerCount, 3)
  })
})

// ─── 6.2 exact-3 / near-3 classification ──────────────────────────────────────

describe('matching classification', () => {
  it('returns exact_3 for route matching demand group ward/block', async () => {
    const results = await matching.computeMatchedDemandGroups('route-001')
    const exact = results.filter((r) => r.matchTier === 'exact_3')
    assert.ok(exact.length > 0, 'Should have at least one exact_3 match')
  })

  it('returns results with tripPrice from route', async () => {
    const results = await matching.computeMatchedDemandGroups('route-001')
    for (const r of results) {
      assert.equal(r.tripPrice, 120000, 'Should carry route tripPrice')
    }
  })

  it('returns empty for non-existent route', async () => {
    const results = await matching.computeMatchedDemandGroups('route-999')
    assert.deepEqual(results, [])
  })
})

// ─── 6.3 visibility mode ──────────────────────────────────────────────────────

describe('computeVisibilityMode', () => {
  it('returns single_client_card for exact_3 + 1 member', async () => {
    assert.equal(
      await matching.computeVisibilityMode('exact_3', 1),
      'single_client_card',
    )
  })

  it('returns group_with_client_list for exact_3 + >1 members', async () => {
    assert.equal(
      await matching.computeVisibilityMode('exact_3', 3),
      'group_with_client_list',
    )
  })

  it('returns group_summary_only for near_3', async () => {
    assert.equal(
      await matching.computeVisibilityMode('near_3', 5),
      'group_summary_only',
    )
  })
})

// ─── 6.4 first-accept-wins ────────────────────────────────────────────────────

describe('first-accept-wins', () => {
  it('accepting one group offer closes siblings', async () => {
    // Create a group request to get offers
    await setupTestDb() // Reset DB to ensure fresh state for this complex test

    const groups = await store.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(multiMemberGroup, 'Need a multi-member group for this test')

    const result = await store.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
    )
    assert.ok(result.offers.length >= 2, 'Should fan out multiple offers')

    // Accept the first offer
    const winnerId = result.offers[0].id
    const accepted = await store.acceptGroupOffer(winnerId)
    assert.equal(accepted.status, 'accepted')

    // Check siblings are closed
    for (const offer of result.offers) {
      if (offer.id === winnerId) continue
      const clientOffers = await store.listGroupOffersByClient(offer.clientId)
      const sibling = clientOffers.find((o) => o.id === offer.id)
      assert.equal(sibling!.status, 'closed', 'Sibling should be closed')
    }
  })

  it('route becomes unavailable after acceptance', async () => {
    assert.equal(
      await store.isRouteAvailable('route-001'),
      false,
      'Route should be unavailable after acceptance',
    )
  })
})

// ─── 6.5 route exclusivity ────────────────────────────────────────────────────

describe('route exclusivity', () => {
  before(async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await store.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(
      multiMemberGroup,
      'Need a multi-member group for exclusivity tests',
    )

    const result = await store.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
    )
    await store.acceptGroupOffer(result.offers[0].id)
  })

  it('rejects new group requests for a route with accepted offer', async () => {
    const groups = await store.deriveDemandGroups()
    const group = groups[0]
    assert.ok(group)

    await assert.rejects(
      async () =>
        await store.createGroupRequest(DRIVER_002_ID, 'route-001', group.id),
      /not available/,
      'Should reject group request for unavailable route',
    )
  })

  it('rejects search request acceptance for unavailable route', async () => {
    assert.equal(await store.isRouteAvailable('route-001'), false)
    assert.equal(await store.isRouteAvailable('route-002'), true)
  })

  it('accepted search request blocks group offer acceptance', async () => {
    // Create a search request for route-002
    const sreq = await store.createSearchRequest(
      CLIENT_002_ID,
      'plan-004',
      'route-002',
    )
    assert.equal(sreq.status, 'pending')

    // Accept it
    const accepted = await store.acceptSearchRequest(sreq.id)
    assert.equal(accepted.status, 'accepted')
    assert.equal(await store.isRouteAvailable('route-002'), false)
  })
})

// ─── 6.6 search request plan linkage ──────────────────────────────────────────

describe('search request plan linkage', () => {
  before(async () => {
    await setupTestDb()
    if (!isDbAvailable()) return
  })

  it('accepts grouped plan linkage when provided', async () => {
    const sreq = await store.createSearchRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    assert.equal(sreq.status, 'pending')
    assert.equal(sreq.planId, 'plan-001')
  })

  it('rejects unknown plan linkage', async () => {
    await assert.rejects(
      async () =>
        await store.createSearchRequest(
          CLIENT_001_ID,
          'plan-missing',
          'route-002',
        ),
      /Plan not found/,
      'Unknown planId should fail validation',
    )
  })

  it('accepts ad hoc search requests without plan linkage', async () => {
    const sreq = await store.createSearchRequest(
      CLIENT_001_ID,
      null,
      'route-002',
    )
    assert.equal(sreq.status, 'pending')
    assert.equal(sreq.planId, null)
  })
})

// ─── 6.7 Single active search requests ──────────────────────────────────────────
describe('single active search request invariant', () => {
  before(async () => {
    await setupTestDb()
    if (!isDbAvailable()) return
  })

  it('migration closes older active duplicates and preserves terminal rows', async () => {
    const route = await store.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-20',
      departureTime: '2030-04-20T07:00:00.000Z',
      tripPrice: 100000,
    })

    await query('DROP INDEX IF EXISTS search_requests_active_client_route_idx')
    await query(
      `
        INSERT INTO search_requests (
          id,
          client_id,
          plan_id,
          route_id,
          driver_id,
          trip_price,
          note,
          status,
          created_at
        )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9),
          ($10, $11, $12, $13, $14, $15, $16, $17, $18),
          ($19, $20, $21, $22, $23, $24, $25, $26, $27)
      `,
      [
        'sreq-mig-old',
        CLIENT_001_ID,
        null,
        route.id,
        route.driverId,
        route.tripPrice,
        'older active request',
        'pending',
        '2030-04-20T06:00:00.000Z',
        'sreq-mig-new',
        CLIENT_001_ID,
        null,
        route.id,
        route.driverId,
        route.tripPrice,
        'newest active request',
        'accepted',
        '2030-04-20T07:00:00.000Z',
        'sreq-mig-terminal',
        CLIENT_001_ID,
        null,
        route.id,
        route.driverId,
        route.tripPrice,
        'terminal request',
        'declined',
        '2030-04-20T05:00:00.000Z',
      ],
    )

    const migrationSql = fs.readFileSync(
      path.join(
        __dirname,
        'db',
        'migrations',
        '06_single_active_search_request.sql',
      ),
      'utf8',
    )
    await query(migrationSql)

    const requests = await store.listSearchRequestsByRoute(route.id)
    const olderRequest = requests.find(
      (request) => request.id === 'sreq-mig-old',
    )
    const newestRequest = requests.find(
      (request) => request.id === 'sreq-mig-new',
    )
    const terminalRequest = requests.find(
      (request) => request.id === 'sreq-mig-terminal',
    )

    assert.equal(olderRequest?.status, 'closed')
    assert.equal(newestRequest?.status, 'accepted')
    assert.equal(terminalRequest?.status, 'declined')
  })

  it('rejects duplicate active search requests for same route and client', async () => {
    const sreq1 = await store.createSearchRequest(
      CLIENT_001_ID,
      null,
      'route-002',
    )
    assert.equal(sreq1.status, 'pending')

    await assert.rejects(
      async () =>
        await store.createSearchRequest(CLIENT_001_ID, null, 'route-002'),
      (err: unknown) => {
        assert.ok(err && typeof err === 'object')
        const conflictError = err as {
          statusCode?: number
          payload?: { existingRequest?: { id?: string } }
        }
        assert.equal(conflictError.statusCode, 409)
        assert.ok(conflictError.payload?.existingRequest)
        assert.equal(conflictError.payload?.existingRequest?.id, sreq1.id)
        return true
      },
      'Should throw 409 conflict and expose existing request payload',
    )
  })

  for (const terminalStatus of TERMINAL_SEARCH_REQUEST_STATUSES) {
    it(`allows resend if the previous request is ${terminalStatus}`, async () => {
      const route = await store.createRoute(DRIVER_001_ID, {
        carId: 'car-001',
        origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
        destination: { lat: 10.85, lng: 106.75, label: 'TD' },
        serviceDate: `2030-04-2${terminalStatus.length}`,
        departureTime: `2030-04-2${terminalStatus.length}T07:00:00.000Z`,
        tripPrice: 100000,
      })
      const initialRequest = await store.createSearchRequest(
        CLIENT_001_ID,
        null,
        route.id,
      )

      await query('UPDATE search_requests SET status = $1 WHERE id = $2', [
        terminalStatus,
        initialRequest.id,
      ])

      const resentRequest = await store.createSearchRequest(
        CLIENT_001_ID,
        null,
        route.id,
      )

      assert.equal(resentRequest.status, 'pending')
      assert.notEqual(
        resentRequest.id,
        initialRequest.id,
        'Should create a new request record after a terminal state',
      )
    })
  }
})

describe('wallet-gated route publish', () => {
  it('publishing a draft reserves the route fee and appends a ledger entry', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await store.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-04-30',
      departureTime: '2030-04-30T07:00:00.000Z',
      tripPrice: 100000,
      distanceMeters: 10000,
    })

    const published = await store.publishRoute(route.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await store.listDriverWalletTransactions(
      DRIVER_001_ID,
      10,
    )

    assert.equal(published.status, 'published')
    assert.equal(published.distanceMeters, 10000)
    assert.equal(published.walletFeeStatus, 'reserved')
    assert.equal(published.feeRateVndPerKm, 500)
    assert.equal(published.feeRequiredVnd, 5000)
    assert.equal(wallet.balanceVnd, 500000)
    assert.equal(wallet.reservedBalanceVnd, 5000)
    assert.equal(wallet.availableBalanceVnd, 495000)
    assert.equal(transactions[0]?.type, 'reservation')
    assert.equal(transactions[0]?.routeId, route.id)
    assert.equal(transactions[0]?.amountVnd, 5000)
  })

  it('rejects publish when the wallet balance is insufficient and keeps the route in draft', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    await query(
      'UPDATE wallets SET balance_vnd = $1, reserved_balance_vnd = 0 WHERE driver_id = $2',
      [100, DRIVER_001_ID],
    )

    const route = await store.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-05-01',
      departureTime: '2030-05-01T07:00:00.000Z',
      tripPrice: 120000,
      distanceMeters: 10000,
    })

    await assert.rejects(
      async () => store.publishRoute(route.id),
      /Insufficient wallet balance/,
    )

    const persisted = await store.getRoute(route.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)

    assert.equal(persisted?.status, 'draft')
    assert.equal(persisted?.walletFeeStatus, 'none')
    assert.equal(wallet.balanceVnd, 100)
    assert.equal(wallet.reservedBalanceVnd, 0)
  })

  it('rejects in-place edits to fee-bearing fields after publish', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await store.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-05-02',
      departureTime: '2030-05-02T07:00:00.000Z',
      tripPrice: 130000,
      distanceMeters: 12000,
    })

    await store.publishRoute(route.id)

    await assert.rejects(
      async () =>
        store.updateRoute(route.id, {
          distanceMeters: 14000,
        }),
      /Published fee-bearing route fields cannot be edited/,
    )
  })
})

describe('wallet-gated accept and cancel transitions', () => {
  it('charges the route fee once when accepting a group offer and ignores retries', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-05-03',
          departureTime: '2030-05-03T07:00:00.000Z',
          tripPrice: 140000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const groups = await store.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(multiMemberGroup, 'Need a multi-member group for group-offer test')

    const groupRequest = await store.createGroupRequest(
      DRIVER_001_ID,
      route.id,
      multiMemberGroup!.id,
    )

    const winnerId = groupRequest.offers[0].id
    const accepted = await store.acceptGroupOffer(winnerId)
    const retry = await store.acceptGroupOffer(winnerId)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await store.listDriverWalletTransactions(
      DRIVER_001_ID,
      20,
    )

    assert.equal(accepted.status, 'accepted')
    assert.equal(retry.status, 'accepted')
    assert.equal(wallet.balanceVnd, 495000)
    assert.equal(wallet.reservedBalanceVnd, 0)
    assert.equal(
      transactions.filter((tx) => tx.type === 'charge').length,
      1,
      'Route fee should be charged exactly once',
    )
    assert.equal(transactions[0]?.type, 'charge')
    assert.equal(transactions[0]?.routeId, route.id)
  })

  it('charges the route fee once when accepting a search request and ignores retries', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-05-04',
          departureTime: '2030-05-04T07:00:00.000Z',
          tripPrice: 150000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const request = await store.createSearchRequest(
      CLIENT_001_ID,
      'plan-001',
      route.id,
    )

    const accepted = await store.acceptSearchRequest(request.id)
    const retry = await store.acceptSearchRequest(request.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await store.listDriverWalletTransactions(
      DRIVER_001_ID,
      20,
    )

    assert.equal(accepted.status, 'accepted')
    assert.equal(retry.status, 'accepted')
    assert.equal(wallet.balanceVnd, 495000)
    assert.equal(wallet.reservedBalanceVnd, 0)
    assert.equal(
      transactions.filter((tx) => tx.type === 'charge').length,
      1,
      'Route fee should be charged exactly once',
    )
    assert.equal(transactions[0]?.type, 'charge')
    assert.equal(transactions[0]?.routeId, route.id)
  })

  it('releases a reserved fee when canceling an unmatched route', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-05-05',
          departureTime: '2030-05-05T07:00:00.000Z',
          tripPrice: 160000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const canceled = await store.cancelTrip(route.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await store.listDriverWalletTransactions(
      DRIVER_001_ID,
      20,
    )

    assert.equal(canceled.status, 'canceled')
    assert.equal((canceled as Route).walletFeeStatus, 'released')
    assert.equal(wallet.balanceVnd, 500000)
    assert.equal(wallet.reservedBalanceVnd, 0)
    assert.equal(
      transactions.filter((tx) => tx.type === 'release').length,
      1,
      'Route fee should be released exactly once',
    )
    assert.equal(transactions[0]?.type, 'release')
    assert.equal(transactions[0]?.routeId, route.id)
  })

  it('refunds a charged fee and cancels the winning plan-side acceptance', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-cancel-plan',
      dropoffWardId: 'ward-cancel-plan-dest',
      serviceDate: '2030-05-06',
      departureBlockStart: '2030-05-06T07:00:00.000Z',
      departureBlockEnd: '2030-05-06T07:30:00.000Z',
      passengerCount: 1,
    })
    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-05-06',
          departureTime: '2030-05-06T07:00:00.000Z',
          tripPrice: 170000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const request = await store.createSearchRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )
    await store.acceptSearchRequest(request.id)

    const canceled = await store.cancelTrip(plan.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const requests = await store.listSearchRequestsByRoute(route.id)
    const canceledRequest = requests.find((item) => item.id === request.id)
    const transactions = await store.listDriverWalletTransactions(
      DRIVER_001_ID,
      20,
    )

    assert.equal(canceled.status, 'canceled')
    assert.equal((canceled as Plan).status, 'canceled')
    assert.equal(wallet.balanceVnd, 500000)
    assert.equal(wallet.reservedBalanceVnd, 0)
    assert.equal(canceledRequest?.status, 'canceled')
    assert.equal(
      transactions.filter((tx) => tx.type === 'refund').length,
      1,
      'Route fee should be refunded exactly once',
    )
    assert.equal(transactions[0]?.type, 'refund')
    assert.equal(transactions[0]?.routeId, route.id)
  })
})

// ─── 6.8 CRUD coverage ────────────────────────────────────────────────────────

describe('CRUD operations', () => {
  it('users CRUD behaves correctly', async () => {
    const user = await store.getUser(DRIVER_001_ID)
    assert.ok(user)
    assert.equal(user.displayName, 'Tài xế 001')

    const updated = await store.setUserMode(DRIVER_001_ID, 'client')
    assert.equal(updated!.preferredMode, 'client')
    assert.ok(updated!.modeSelectedAt)

    const mode = await store.getUserMode(DRIVER_001_ID)
    assert.equal(mode!.preferredMode, 'client')
  })

  it('cars CRUD behaves correctly', async () => {
    const car = await store.createCar(DRIVER_001_ID, {
      plateNumberFull: '12A-12345',
      plateNumberMasked: '12A***45',
      brand: 'Test',
      model: 'Car',
      color: 'Red',
      seatCapacity: 4,
      verificationStatus: 'unverified',
      photos: [],
    })

    assert.ok(car.id)

    const cars = await store.listCarsByOwner(DRIVER_001_ID)
    assert.ok(cars.find((c) => c.id === car.id))

    const updated = await store.updateCar(car.id, { color: 'Blue' })
    assert.equal(updated!.color, 'Blue')

    const deleted = await store.deleteCar(car.id)
    assert.ok(deleted)
  })
})
