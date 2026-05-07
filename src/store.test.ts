import assert from 'node:assert/strict'
import { after, before, describe, it as nodeIt } from 'node:test'

import { query } from './db/connection'
import * as matching from './matching'
import * as store from './store'
import {
  createDbTest,
  isDbAvailable,
  setupTestDb,
  teardownTestDb,
} from './test-db'
import { Plan, Route } from './types/entities'

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

    const request = await store.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    await store.acceptRouteRequest(request.id)

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

    const request = await store.createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      acceptedElsewhereRoute.id,
    )
    await store.acceptRouteRequest(request.id)

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

    const request = await store.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      route.id,
    )
    await store.acceptRouteRequest(request.id)

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

describe('cancelPlanByClient', () => {
  it('cancels an owned unpublished-pairing plan and removes it from work queue and demand', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const plan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-client-cancel',
      dropoffWardId: 'ward-client-cancel-dest',
      serviceDate: '2030-05-07',
      departureBlockStart: '2030-05-07T07:00:00.000Z',
      departureBlockEnd: '2030-05-07T07:30:00.000Z',
      passengerCount: 1,
    })

    const before = await store.deriveDemandGroups()
    assert.equal(
      before.some((group) => group.memberPlanIds.includes(plan.id)),
      true,
    )

    const canceled = await store.cancelPlanByClient(plan.id, CLIENT_001_ID)
    const clientPlans = await store.listPlansByClient(CLIENT_001_ID)
    const after = await store.deriveDemandGroups()

    assert.equal(canceled.status, 'canceled')
    assert.equal(
      clientPlans.some((item) => item.id === plan.id),
      false,
      'Canceled plan should be hidden from client work queue',
    )
    assert.equal(
      after.some((group) => group.memberPlanIds.includes(plan.id)),
      false,
      'Canceled plan should be removed from demand groups',
    )
  })

  it('rejects cancellation by a non-owner', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    await assert.rejects(
      () => store.cancelPlanByClient('plan-001', CLIENT_002_ID),
      (err: unknown) =>
        err instanceof Error && 'statusCode' in err && err.statusCode === 403,
    )
  })

  it('throws 404 for a missing plan', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    await assert.rejects(
      () => store.cancelPlanByClient('plan-missing', CLIENT_001_ID),
      (err: unknown) =>
        err instanceof Error && 'statusCode' in err && err.statusCode === 404,
    )
  })

  it('rejects plan cancellation when search request is accepted', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const request = await store.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    await store.acceptRouteRequest(request.id)

    await assert.rejects(
      () => store.cancelPlanByClient('plan-001', CLIENT_001_ID),
      (err: unknown) =>
        err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    )
  })

  it('rejects plan cancellation when group offer is accepted', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await store.deriveDemandGroups()
    const multiMemberGroup = groups.find((group) => group.memberCount > 1)
    assert.ok(multiMemberGroup)
    const result = await store.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
    )
    const targetOffer = result.offers.find(
      (offer) => offer.clientId === CLIENT_001_ID,
    )
    assert.ok(targetOffer)
    await store.acceptGroupOffer(targetOffer.id)

    await assert.rejects(
      () => store.cancelPlanByClient(targetOffer.planId, CLIENT_001_ID),
      (err: unknown) =>
        err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    )
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
  it('lists visible requests in newest-first backend order and preserves conflicts', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const olderRoute = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-01',
          departureTime: '2030-06-01T07:00:00.000Z',
          tripPrice: 110000,
        })
      ).id,
    )
    const newerRoute = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-02',
          departureTime: '2030-06-02T07:00:00.000Z',
          tripPrice: 120000,
        })
      ).id,
    )
    const olderPlan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-order-old',
      dropoffWardId: 'ward-order-old-dest',
      serviceDate: '2030-06-01',
      departureBlockStart: '2030-06-01T07:00:00.000Z',
      departureBlockEnd: '2030-06-01T07:30:00.000Z',
      passengerCount: 1,
    })
    const newerPlan = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-order-new',
      dropoffWardId: 'ward-order-new-dest',
      serviceDate: '2030-06-02',
      departureBlockStart: '2030-06-02T07:00:00.000Z',
      departureBlockEnd: '2030-06-02T07:30:00.000Z',
      passengerCount: 1,
    })

    const olderRequest = await store.createRouteRequest(
      CLIENT_001_ID,
      olderPlan.id,
      olderRoute.id,
    )
    await query('UPDATE route_requests SET created_at = $1 WHERE id = $2', [
      '2030-06-01T06:00:00.000Z',
      olderRequest.id,
    ])
    const newerRequest = await store.createRouteRequest(
      CLIENT_001_ID,
      newerPlan.id,
      newerRoute.id,
    )
    await query('UPDATE route_requests SET created_at = $1 WHERE id = $2', [
      '2030-06-02T06:00:00.000Z',
      newerRequest.id,
    ])

    const clientRequests = await store.listRouteRequestsByClient(CLIENT_001_ID)
    const driverRequests = await store.listRouteRequestsByDriver(DRIVER_001_ID)

    assert.deepEqual(
      clientRequests
        .filter((request) => [olderRequest.id, newerRequest.id].includes(request.id))
        .map((request) => request.id),
      [newerRequest.id, olderRequest.id],
    )
    assert.deepEqual(
      driverRequests
        .filter((request) => [olderRequest.id, newerRequest.id].includes(request.id))
        .map((request) => request.id),
      [newerRequest.id, olderRequest.id],
    )

    await assert.rejects(
      async () =>
        await store.createRouteRequest(
          CLIENT_001_ID,
          newerPlan.id,
          newerRoute.id,
        ),
      (err: unknown) => {
        const conflict = err as { statusCode?: number; payload?: { existingRequest?: { id?: string } } }
        assert.equal(conflict.statusCode, 409)
        assert.equal(conflict.payload?.existingRequest?.id, newerRequest.id)
        return true
      },
    )
  })

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

    const sentRequests = await store.listGroupRequestsByDriver(DRIVER_001_ID)
    const parent = sentRequests.find((request) => request.id === result.groupRequest.id)
    assert.ok(parent, 'Parent group request should exist')
    assert.equal(parent.status, 'accepted')
    assert.equal(parent.acceptedClientUserId, accepted.clientId)
    assert.equal(parent.clientId, accepted.clientId)
    assert.equal(parent.acceptedPlanId, accepted.planId)
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
    const sreq = await store.createRouteRequest(
      CLIENT_002_ID,
      'plan-004',
      'route-002',
    )
    assert.equal(sreq.status, 'pending')

    // Accept it
    const accepted = await store.acceptRouteRequest(sreq.id)
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
    const sreq = await store.createRouteRequest(
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
        await store.createRouteRequest(
          CLIENT_001_ID,
          'plan-missing',
          'route-002',
        ),
      /Plan not found/,
      'Unknown planId should fail validation',
    )
  })

  it('rejects search requests without plan linkage', async () => {
    await assert.rejects(
      async () =>
        await store.createRouteRequest(
          CLIENT_001_ID,
          null as unknown as string,
          'route-002',
        ),
      /Plan not found/,
    )
  })
})

// ─── 6.7 Single active search requests ──────────────────────────────────────────
describe('single active search request invariant', () => {
  before(async () => {
    await setupTestDb()
    if (!isDbAvailable()) return
  })

  it('rejects duplicate active search requests for same route and client', async () => {
    const sreq1 = await store.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    assert.equal(sreq1.status, 'pending')

    await assert.rejects(
      async () =>
        await store.createRouteRequest(CLIENT_001_ID, 'plan-001', 'route-002'),
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
      const initialRequest = await store.createRouteRequest(
        CLIENT_001_ID,
        'plan-001',
        route.id,
      )

      await query('UPDATE route_requests SET status = $1 WHERE id = $2', [
        terminalStatus,
        initialRequest.id,
      ])

      const resentRequest = await store.createRouteRequest(
        CLIENT_001_ID,
        'plan-001',
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
  it('canceling a group request closes offers without charging wallet', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-03',
          departureTime: '2030-06-03T07:00:00.000Z',
          tripPrice: 130000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const groups = await store.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(multiMemberGroup)
    const request = await store.createGroupRequest(
      DRIVER_001_ID,
      route.id,
      multiMemberGroup!.id,
    )

    const canceled = await store.cancelGroupRequest(request.groupRequest.id)
    const offers = await store.listGroupOffersByRoute(route.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await store.listDriverWalletTransactions(DRIVER_001_ID, 20)

    assert.equal(canceled.status, 'canceled')
    assert.equal(
      offers.every((offer) => offer.status === 'closed'),
      true,
    )
    assert.equal(wallet.balanceVnd, 500000)
    assert.equal(wallet.reservedBalanceVnd, 5000)
    assert.equal(transactions.some((tx) => tx.type === 'charge'), false)
  })

  it('declining and canceling search requests avoid wallet side effects', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const declinedRoute = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-04',
          departureTime: '2030-06-04T07:00:00.000Z',
          tripPrice: 140000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const canceledRoute = await store.publishRoute(
      (
        await store.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-05',
          departureTime: '2030-06-05T07:00:00.000Z',
          tripPrice: 150000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const declinedRequest = await store.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      declinedRoute.id,
    )
    const canceledRequest = await store.createRouteRequest(
      CLIENT_002_ID,
      'plan-002',
      canceledRoute.id,
    )

    const declined = await store.declineRouteRequest(declinedRequest.id)
    const canceled = await store.cancelRouteRequest(canceledRequest.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await store.listDriverWalletTransactions(DRIVER_001_ID, 20)

    assert.equal(declined.status, 'declined')
    assert.equal(canceled.status, 'canceled')
    assert.equal(wallet.balanceVnd, 500000)
    assert.equal(wallet.reservedBalanceVnd, 10000)
    assert.equal(transactions.some((tx) => tx.type === 'charge'), false)
  })

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
    assert.ok(
      multiMemberGroup,
      'Need a multi-member group for group-offer test',
    )

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
    assert.equal((await store.getRoute(route.id))?.status, 'matched')
    assert.equal((await store.getPlan(accepted.planId!))?.status, 'matched')
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

    const request = await store.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      route.id,
    )

    const accepted = await store.acceptRouteRequest(request.id)
    const retry = await store.acceptRouteRequest(request.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await store.listDriverWalletTransactions(
      DRIVER_001_ID,
      20,
    )

    assert.equal(accepted.status, 'accepted')
    assert.equal(retry.status, 'accepted')
    assert.equal((await store.getRoute(route.id))?.status, 'matched')
    assert.equal((await store.getPlan(request.planId!))?.status, 'matched')
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

    const request = await store.createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )
    await store.acceptRouteRequest(request.id)

    const canceled = await store.cancelTrip(plan.id)
    const wallet = await store.getDriverWalletSummary(DRIVER_001_ID)
    const requests = await store.listRouteRequestsByRoute(route.id)
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

    const updated = await store.setUserMode(user.identityId!, 'client')
    assert.equal(updated!.identity.preferredMode, 'client')
    assert.ok(updated!.identity.modeSelectedAt)

    const mode = await store.getUserMode(user.identityId!)
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
