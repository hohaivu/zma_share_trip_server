import assert from 'node:assert/strict'
import { after, before, describe, it as nodeIt } from 'node:test'

import { query } from '../src/db/connection'
import * as matching from '../src/matching'
import * as carService from '../src/services/carService'
import * as driverRouteRepository from '../src/repositories/driverRouteRepository'
import * as driverRouteService from '../src/services/driverRouteService'
import * as groupOfferService from '../src/services/groupOfferService'
import * as groupRequestRepository from '../src/repositories/groupRequestRepository'
import * as groupRequestService from '../src/services/groupRequestService'
import * as journeyRepository from '../src/repositories/journeyRepository'
import { journeyService } from '../src/services/journeyService'
import * as planService from '../src/services/planService'
import * as routeRequestService from '../src/services/routeRequestService'
import * as userService from '../src/services/userService'
import * as walletService from '../src/services/walletService'
import {
  createDbTest,
  isDbAvailable,
  setupTestDb,
  teardownTestDb,
} from '../src/test-db'
import { Plan, Route } from '../src/types/entities'

const it = createDbTest('Postgres unavailable for DB-backed MVC module tests')
const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const DRIVER_002_ID = 'a1b2c3d4-0002-4000-8000-000000000002'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'
const CLIENT_002_ID = 'a1b2c3d4-0004-4000-8000-000000000004'
const TERMINAL_SEARCH_REQUEST_STATUSES = [
  'declined',
  'closed',
  'expired',
] as const

async function markRouteFeeReserved(routeId: string): Promise<void> {
  await query(
    "UPDATE routes SET wallet_fee_status = 'reserved', fee_required_vnd = COALESCE(fee_required_vnd, 0) WHERE id = $1",
    [routeId],
  )
}

async function createPublishedRouteAt(suffix: string, startIso: string, endIso: string): Promise<Route> {
  const route = await driverRouteService.createRoute(DRIVER_001_ID, {
    carId: 'car-001',
    origin: { lat: 10.77, lng: 106.7, label: `Q1-${suffix}` },
    destination: { lat: 10.85, lng: 106.75, label: `TD-${suffix}` },
    serviceDate: startIso.slice(0, 10),
    departureTime: startIso,
    windowStart: startIso,
    windowEnd: endIso,
    tripPrice: 110000,
    distanceMeters: 10000,
  })
  return driverRouteService.publishRoute(route.id)
}

async function createPlanAt(clientId: string, suffix: string, startIso: string, endIso: string): Promise<Plan> {
  return planService.createPlan(clientId, {
    pickup: { lat: 10.77, lng: 106.7, label: `Q1-${suffix}` },
    dropoff: { lat: 10.85, lng: 106.75, label: `TD-${suffix}` },
    pickupWardId: `ward-pickup-${suffix}`,
    dropoffWardId: `ward-dropoff-${suffix}`,
    pickupWardKey: `ward-pickup-${suffix}_hcm`,
    dropoffWardKey: `ward-dropoff-${suffix}_hcm`,
    pickupProvinceId: 'hcm',
    dropoffProvinceId: 'hcm',
    serviceDate: startIso.slice(0, 10),
    departureBlockStart: startIso,
    departureBlockEnd: endIso,
    passengerCount: 1,
  })
}

// Note: require resets are not trivial in CJS, so tests use the shared
// MVC module graph. Tests should not depend on ordering within a describe block.

before(async () => {
  await setupTestDb()
})

after(async () => {
  await teardownTestDb()
})

// ─── 6.1 deriveDemandGroups ────────────────────────────────────────────────────


describe('MVC request services first-accept-wins behavior', () => {
  it('lists visible requests in newest-first backend order and preserves conflicts', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const olderRoute = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-01',
          departureTime: '2030-06-01T07:00:00.000Z',
          tripPrice: 110000,
            distanceMeters: 10000,
        })
      ).id,
    )
    const newerRoute = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-02',
          departureTime: '2030-06-02T07:00:00.000Z',
          tripPrice: 120000,
            distanceMeters: 10000,
        })
      ).id,
    )
    const olderPlan = await planService.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-order-old',
      dropoffWardId: 'ward-order-old-dest',
      serviceDate: '2030-06-01',
      departureBlockStart: '2030-06-01T07:00:00.000Z',
      departureBlockEnd: '2030-06-01T07:30:00.000Z',
      passengerCount: 1,
    })
    const newerPlan = await planService.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-order-new',
      dropoffWardId: 'ward-order-new-dest',
      serviceDate: '2030-06-02',
      departureBlockStart: '2030-06-02T07:00:00.000Z',
      departureBlockEnd: '2030-06-02T07:30:00.000Z',
      passengerCount: 1,
    })

    const olderRequest = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      olderPlan.id,
      olderRoute.id,
    )
    await query('UPDATE route_requests SET created_at = $1 WHERE id = $2', [
      '2030-06-01T06:00:00.000Z',
      olderRequest.id,
    ])
    const newerRequest = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      newerPlan.id,
      newerRoute.id,
    )
    await query('UPDATE route_requests SET created_at = $1 WHERE id = $2', [
      '2030-06-02T06:00:00.000Z',
      newerRequest.id,
    ])

    const clientRequests = await routeRequestService.listRouteRequestsByClient(CLIENT_001_ID)
    const driverRequests = await routeRequestService.listRouteRequestsByDriver(DRIVER_001_ID)

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
        await routeRequestService.createRouteRequest(
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

    const groups = await groupRequestRepository.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(multiMemberGroup, 'Need a multi-member group for this test')

    const result = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
    )
    assert.ok(result.offers.length >= 2, 'Should fan out multiple offers')

    // Accept the first offer
    const winnerId = result.offers[0].id
    await markRouteFeeReserved('route-001')
    const accepted = await groupOfferService.acceptGroupOffer(winnerId)
    assert.equal(accepted.status, 'accepted')

    // Check siblings are closed
    for (const offer of result.offers) {
      if (offer.id === winnerId) continue
      const clientOffers = await groupOfferService.listGroupOffersByClient(offer.clientId)
      const sibling = clientOffers.find((o) => o.id === offer.id)
      assert.equal(sibling!.status, 'closed', 'Sibling should be closed')
    }

    const sentRequests = await groupRequestService.listGroupRequestsByDriver(DRIVER_001_ID)
    const parent = sentRequests.find((request) => request.id === result.groupRequest.id)
    assert.ok(parent, 'Parent group request should exist')
    assert.equal(parent.status, 'accepted')
    assert.equal(parent.acceptedClientUserId, accepted.clientId)
    assert.equal(parent.clientId, accepted.clientId)
    assert.equal(parent.acceptedPlanId, accepted.planId)
  })

  it('route becomes unavailable after acceptance', async () => {
    assert.equal(
      await driverRouteRepository.isRouteAvailable('route-001'),
      false,
      'Route should be unavailable after acceptance',
    )
  })
})

describe('ALI-83 request expiry and trip edit invalidation', () => {
  it('lazily expires pending route requests and group offers at the earlier trip end', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('expire', '2030-07-01T07:00:00.000Z', '2030-07-01T08:00:00.000Z')
    const plan = await createPlanAt(CLIENT_001_ID, 'expire', '2030-07-01T07:00:00.000Z', '2030-07-01T07:30:00.000Z')
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await query("INSERT INTO group_requests (id, driver_id, route_id, demand_group_id, note, status, created_at) VALUES ('greq-ali83-expire', $1, $2, 'dg-ali83-expire', '', 'pending', NOW())", [DRIVER_001_ID, route.id])
    await query("INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at) VALUES ('goffer-ali83-expire', 'greq-ali83-expire', $1, $2, $3, $4, 110000, 'pending', NOW())", [route.id, DRIVER_001_ID, CLIENT_001_ID, plan.id])
    await query("UPDATE plans SET departure_block_end = NOW() - INTERVAL '1 minute' WHERE id = $1", [plan.id])

    await routeRequestService.listRouteRequestsByClient(CLIENT_001_ID)
    const statuses = await query(
      `SELECT (SELECT status FROM route_requests WHERE id = $1) AS request_status,
              (SELECT status FROM group_offers WHERE id = 'goffer-ali83-expire') AS offer_status`,
      [request.id],
    )
    assert.equal(statuses.rows[0].request_status, 'expired')
    assert.equal(statuses.rows[0].offer_status, 'expired')
  })

  it('allows route request acceptance after start but before both original end times', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('midtrip', '2030-07-02T07:00:00.000Z', '2030-07-02T08:00:00.000Z')
    const plan = await createPlanAt(CLIENT_001_ID, 'midtrip', '2030-07-02T07:00:00.000Z', '2030-07-02T08:00:00.000Z')
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await query("UPDATE routes SET departure_time = NOW() - INTERVAL '10 minutes', window_start = NOW() - INTERVAL '10 minutes', window_end = NOW() + INTERVAL '50 minutes' WHERE id = $1", [route.id])
    await query("UPDATE plans SET departure_block_start = NOW() - INTERVAL '10 minutes', departure_block_end = NOW() + INTERVAL '50 minutes' WHERE id = $1", [plan.id])
    await markRouteFeeReserved(route.id)

    const accepted = await routeRequestService.acceptRouteRequest(request.id)
    assert.equal(accepted.status, 'accepted')
  })

  it('core route edit closes pending route requests and group offers', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('route-edit', '2030-07-03T07:00:00.000Z', '2030-07-03T08:00:00.000Z')
    const plan = await createPlanAt(CLIENT_001_ID, 'route-edit', '2030-07-03T07:00:00.000Z', '2030-07-03T08:00:00.000Z')
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await query("INSERT INTO group_requests (id, driver_id, route_id, demand_group_id, note, status, created_at) VALUES ('greq-ali83-route-edit', $1, $2, 'dg-ali83-route-edit', '', 'pending', NOW())", [DRIVER_001_ID, route.id])
    await query("INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at) VALUES ('goffer-ali83-route-edit', 'greq-ali83-route-edit', $1, $2, $3, $4, 110000, 'pending', NOW())", [route.id, DRIVER_001_ID, CLIENT_001_ID, plan.id])

    await query("UPDATE routes SET wallet_fee_status = 'none', fee_required_vnd = 0 WHERE id = $1", [route.id])
    await driverRouteService.updateRoute(route.id, { windowEnd: '2030-07-03T08:15:00.000Z' })
    const statuses = await query(`SELECT (SELECT status FROM route_requests WHERE id = $1) AS request_status, (SELECT status FROM group_offers WHERE id = 'goffer-ali83-route-edit') AS offer_status, (SELECT status FROM group_requests WHERE id = 'greq-ali83-route-edit') AS group_request_status`, [request.id])
    assert.equal(statuses.rows[0].request_status, 'closed')
    assert.equal(statuses.rows[0].offer_status, 'closed')
    assert.equal(statuses.rows[0].group_request_status, 'closed')
  })

  it('core plan edit closes pending route requests and group offers', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('plan-edit', '2030-07-04T07:00:00.000Z', '2030-07-04T08:00:00.000Z')
    const plan = await createPlanAt(CLIENT_001_ID, 'plan-edit', '2030-07-04T07:00:00.000Z', '2030-07-04T08:00:00.000Z')
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await query("INSERT INTO group_requests (id, driver_id, route_id, demand_group_id, note, status, created_at) VALUES ('greq-ali83-plan-edit', $1, $2, 'dg-ali83-plan-edit', '', 'pending', NOW())", [DRIVER_001_ID, route.id])
    await query("INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at) VALUES ('goffer-ali83-plan-edit', 'greq-ali83-plan-edit', $1, $2, $3, $4, 110000, 'pending', NOW())", [route.id, DRIVER_001_ID, CLIENT_001_ID, plan.id])

    await planService.updatePlan(plan.id, { passengerCount: 2 })
    const statuses = await query(`SELECT (SELECT status FROM route_requests WHERE id = $1) AS request_status, (SELECT status FROM group_offers WHERE id = 'goffer-ali83-plan-edit') AS offer_status, (SELECT status FROM group_requests WHERE id = 'greq-ali83-plan-edit') AS group_request_status`, [request.id])
    assert.equal(statuses.rows[0].request_status, 'closed')
    assert.equal(statuses.rows[0].offer_status, 'closed')
    assert.equal(statuses.rows[0].group_request_status, 'closed')
  })
})

describe('MVC request services idempotent group send', () => {
  it('rejects group send for a non-published route without creating parent or offers', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 0)
    assert.ok(group, 'Need a demand group for unpublished route test')
    const draftRoute = await driverRouteService.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      serviceDate: '2030-06-05',
      departureTime: '2030-06-05T07:00:00.000Z',
      tripPrice: 127000,
      distanceMeters: 10000,
    })

    await assert.rejects(
      async () =>
        groupRequestService.createGroupRequest(DRIVER_001_ID, draftRoute.id, group.id),
      (err: unknown) => {
        const conflict = err as {
          statusCode?: number
          payload?: { createdCount?: number; candidateResults?: unknown[] }
        }
        assert.equal(conflict.statusCode, 409)
        assert.equal(conflict.payload?.createdCount, 0)
        assert.equal(conflict.payload?.candidateResults?.length, group.memberPlanIds.length)
        return true
      },
    )

    const parentCount = await query(
      'SELECT COUNT(*)::int AS count FROM group_requests WHERE route_id = $1',
      [draftRoute.id],
    )
    const offerCount = await query(
      'SELECT COUNT(*)::int AS count FROM group_offers WHERE route_id = $1',
      [draftRoute.id],
    )
    assert.equal(Number(parentCount.rows[0].count), 0)
    assert.equal(Number(offerCount.rows[0].count), 0)
  })

  it('deduplicates duplicate memberPlanIds and reruns skip existing offers', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for duplicate memberPlanIds test')
    const uniquePlanIds = group.memberPlanIds.slice(0, 2)
    assert.equal(uniquePlanIds.length, 2)
    const duplicateMemberPlanIds = [uniquePlanIds[0], uniquePlanIds[1], uniquePlanIds[0], uniquePlanIds[1]]

    const first = await groupRequestRepository.createGroupRequestWithOffers({
      driverId: DRIVER_001_ID,
      routeId: 'route-001',
      demandGroupId: group.id,
      memberPlanIds: duplicateMemberPlanIds,
    })

    assert.equal(first.outcome, 'created')
    assert.equal(first.createdCount, uniquePlanIds.length)
    assert.equal(first.offers.length, uniquePlanIds.length)
    assert.ok(first.candidateResults)
    assert.deepEqual(first.candidateResults.map((candidate) => candidate.planId), uniquePlanIds)

    const offersAfterFirst = await query(
      `SELECT plan_id, COUNT(*)::int AS count
       FROM group_offers
       WHERE route_id = $1 AND plan_id = ANY($2) AND status = 'pending'
       GROUP BY plan_id`,
      ['route-001', uniquePlanIds],
    )
    assert.equal(offersAfterFirst.rowCount, uniquePlanIds.length)
    for (const row of offersAfterFirst.rows) {
      assert.equal(Number(row.count), 1)
    }

    const second = await groupRequestRepository.createGroupRequestWithOffers({
      driverId: DRIVER_001_ID,
      routeId: 'route-001',
      demandGroupId: group.id,
      memberPlanIds: duplicateMemberPlanIds,
    })

    assert.equal(second.outcome, 'no_new_requests')
    assert.equal(second.createdCount, 0)
    assert.equal(second.offers.length, 0)
    assert.ok(second.candidateResults)
    assert.deepEqual(
      second.candidateResults.map((candidate) => candidate.status),
      uniquePlanIds.map(() => 'skipped_existing'),
    )

    const offersAfterSecond = await query(
      `SELECT COUNT(*)::int AS count
       FROM group_offers
       WHERE route_id = $1 AND plan_id = ANY($2) AND status = 'pending'`,
      ['route-001', uniquePlanIds],
    )
    assert.equal(Number(offersAfterSecond.rows[0].count), uniquePlanIds.length)
  })

  it('stores target plan/client identity on targeted pending group request parent', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for targeted group-send test')
    const targetPlanId = group.memberPlanIds[1]
    assert.ok(targetPlanId)

    const planRes = await query('SELECT client_id FROM plans WHERE id = $1', [
      targetPlanId,
    ])
    const targetClientId = planRes.rows[0]?.client_id
    assert.ok(targetClientId)

    const result = await groupRequestRepository.createGroupRequestWithOffers({
      driverId: DRIVER_001_ID,
      routeId: 'route-001',
      demandGroupId: group.id,
      memberPlanIds: [targetPlanId],
      targetPlanId,
    })

    assert.equal(result.createdCount, 1)
    assert.equal(result.groupRequest.clientId, targetClientId)
    assert.equal(result.groupRequest.acceptedPlanId, targetPlanId)
    assert.deepEqual(result.offers.map((offer) => offer.planId), [targetPlanId])

    const listed = await groupRequestRepository.listGroupRequestsByDriver(
      DRIVER_001_ID,
    )
    const listedRequest = listed.find((request) => request.id === result.groupRequest.id)
    assert.ok(listedRequest)
    assert.equal(listedRequest.clientId, targetClientId)
    assert.equal(listedRequest.acceptedPlanId, targetPlanId)
  })

  it('auto-matches oldest reciprocal route request and stops group-send batch', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for reciprocal group-send test')

    const olderPlanId = group.memberPlanIds[0]
    const newerPlanId = group.memberPlanIds[1]
    assert.ok(olderPlanId)
    assert.ok(newerPlanId)
    const planClientsRes = await query('SELECT id, client_id FROM plans WHERE id = ANY($1)', [
      [olderPlanId, newerPlanId],
    ])
    const clientByPlanId = new Map(planClientsRes.rows.map((row) => [row.id, row.client_id]))
    const olderClientId = clientByPlanId.get(olderPlanId)
    const newerClientId = clientByPlanId.get(newerPlanId)
    assert.ok(olderClientId)
    assert.ok(newerClientId)

    const olderRequest = await routeRequestService.createRouteRequest(
      olderClientId,
      olderPlanId,
      'route-001',
    )
    const newerRequest = await routeRequestService.createRouteRequest(
      newerClientId,
      newerPlanId,
      'route-001',
    )
    await query('UPDATE route_requests SET created_at = $1 WHERE id = $2', [
      '2030-06-01T06:00:00.000Z',
      olderRequest.id,
    ])
    await query('UPDATE route_requests SET created_at = $1 WHERE id = $2', [
      '2030-06-01T06:05:00.000Z',
      newerRequest.id,
    ])
    await markRouteFeeReserved('route-001')

    const result = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
    )

    assert.equal(result.outcome, 'matched')
    assert.equal(result.createdCount, 1)
    assert.equal(result.skippedCount, 0)
    assert.equal(result.refreshHint, 'none')
    assert.equal(result.offers.length, 1)
    assert.equal(result.matchedOffer?.id, result.offers[0].id)
    assert.equal(result.matchedRouteRequest?.id, olderRequest.id)
    assert.deepEqual(result.candidateResults, [{ planId: olderPlanId, status: 'matched' }])
    assert.deepEqual(result.match, {
      kind: 'reciprocal_request',
      sourceRouteRequestId: olderRequest.id,
      acceptedGroupOfferId: result.offers[0].id,
      routeId: 'route-001',
      planId: olderPlanId,
      clientId: olderClientId,
      driverId: DRIVER_001_ID,
    })

    const offerRes = await query('SELECT * FROM group_offers WHERE id = $1', [
      result.offers[0].id,
    ])
    assert.equal(offerRes.rows[0].status, 'accepted')
    assert.equal(offerRes.rows[0].source_route_request_id, olderRequest.id)
    assert.equal(offerRes.rows[0].plan_id, olderPlanId)
    assert.equal(offerRes.rows[0].client_id, olderClientId)

    const routeRequestsRes = await query(
      'SELECT id, status, accepted_group_offer_id FROM route_requests WHERE id = ANY($1) ORDER BY id',
      [[olderRequest.id, newerRequest.id]],
    )
    const requestsById = new Map(routeRequestsRes.rows.map((row) => [row.id, row]))
    assert.equal(requestsById.get(olderRequest.id)?.status, 'accepted')
    assert.equal(
      requestsById.get(olderRequest.id)?.accepted_group_offer_id,
      result.offers[0].id,
    )
    assert.equal(requestsById.get(newerRequest.id)?.status, 'closed')

    const routeRes = await query('SELECT status FROM routes WHERE id = $1', ['route-001'])
    assert.equal(routeRes.rows[0].status, 'matched')
    const plansRes = await query('SELECT id, status FROM plans WHERE id = ANY($1)', [
      [olderPlanId, newerPlanId],
    ])
    const plansById = new Map(plansRes.rows.map((row) => [row.id, row.status]))
    assert.equal(plansById.get(olderPlanId), 'matched')

    const pendingOffersRes = await query(
      'SELECT COUNT(*)::int AS count FROM group_offers WHERE route_id = $1 AND status = $2',
      ['route-001', 'pending'],
    )
    assert.equal(Number(pendingOffersRes.rows[0].count), 0)
    const allOffersRes = await query(
      'SELECT COUNT(*)::int AS count FROM group_offers WHERE route_id = $1',
      ['route-001'],
    )
    assert.equal(Number(allOffersRes.rows[0].count), 1)
  })

  it('auto-matches a reciprocal pending group offer on direct route request send', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for reciprocal route-send test')

    const groupSend = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
    )
    assert.equal(groupSend.outcome, 'created')
    assert.ok(groupSend.offers.length > 0, 'Should create at least one pending group offer')

    const offer = groupSend.offers[0]
    await markRouteFeeReserved('route-001')

    const routeRequest = await routeRequestService.createRouteRequest(
      offer.clientId,
      offer.planId,
      'route-001',
    )

    assert.equal(routeRequest.status, 'accepted')
    assert.equal(routeRequest.acceptedGroupOfferId, offer.id)

    const offerRes = await query(
      'SELECT status, source_route_request_id FROM group_offers WHERE id = $1',
      [offer.id],
    )
    assert.equal(offerRes.rows[0].status, 'accepted')
    assert.equal(offerRes.rows[0].source_route_request_id, routeRequest.id)

    const routeRes = await query('SELECT status FROM routes WHERE id = $1', ['route-001'])
    assert.equal(routeRes.rows[0].status, 'matched')
    const planRes = await query('SELECT status FROM plans WHERE id = $1', [offer.planId])
    assert.equal(planRes.rows[0].status, 'matched')

    const parentRes = await query(
      'SELECT status, accepted_client_user_id, accepted_plan_id, client_id FROM group_requests WHERE id = $1',
      [groupSend.groupRequest.id],
    )
    assert.equal(parentRes.rows[0].status, 'accepted')
    assert.equal(parentRes.rows[0].accepted_client_user_id, offer.clientId)
    assert.equal(parentRes.rows[0].accepted_plan_id, offer.planId)
    assert.equal(parentRes.rows[0].client_id, offer.clientId)
  })

  it('group offer acceptance closes competitors by same route and same plan only', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group)
    const sent = await groupRequestService.createGroupRequest(DRIVER_001_ID, 'route-001', group.id)
    const winner = sent.offers[0]
    const samePlanRouteRequestId = 'sreq-same-plan-close'
    const unrelatedRouteRequestId = 'sreq-unrelated-open'
    const unrelatedPlanId = sent.offers.find((offer) => offer.planId !== winner.planId)?.planId
    assert.ok(unrelatedPlanId)

    await query(
      `INSERT INTO route_requests (id, client_id, plan_id, route_id, driver_id, trip_price, status, created_at)
       VALUES ($1, $2, $3, 'route-002', $4, 100000, 'pending', NOW())`,
      [samePlanRouteRequestId, winner.clientId, winner.planId, DRIVER_001_ID],
    )
    await query(
      `INSERT INTO route_requests (id, client_id, plan_id, route_id, driver_id, trip_price, status, created_at)
       VALUES ($1, $2, $3, 'route-002', $4, 100000, 'pending', NOW())`,
      [unrelatedRouteRequestId, CLIENT_002_ID, unrelatedPlanId, DRIVER_001_ID],
    )
    await markRouteFeeReserved('route-001')

    await groupOfferService.acceptGroupOffer(winner.id)

    const statuses = await query(
      `SELECT id, status FROM route_requests WHERE id = ANY($1)
       UNION ALL SELECT id, status FROM group_offers WHERE id = ANY($2)`,
      [[samePlanRouteRequestId, unrelatedRouteRequestId], sent.offers.map((offer) => offer.id)],
    )
    const byId = new Map(statuses.rows.map((row) => [row.id, row.status]))
    assert.equal(byId.get(samePlanRouteRequestId), 'closed')
    assert.equal(byId.get(unrelatedRouteRequestId), 'pending')
    for (const offer of sent.offers) {
      assert.equal(byId.get(offer.id), offer.id === winner.id ? 'accepted' : 'closed')
    }
  })

  it('route request acceptance closes competitors by same route and same plan only', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, 'plan-001', 'route-001')
    const samePlanOfferId = 'goffer-same-plan-close'
    const unrelatedOfferId = 'goffer-unrelated-open'
    await query(
      `INSERT INTO group_offers (id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at)
       VALUES ($1, 'route-002', $2, $3, 'plan-001', 100000, 'pending', NOW())`,
      [samePlanOfferId, DRIVER_001_ID, CLIENT_001_ID],
    )
    await query(
      `INSERT INTO group_offers (id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at)
       VALUES ($1, 'route-002', $2, $3, 'plan-004', 100000, 'pending', NOW())`,
      [unrelatedOfferId, DRIVER_001_ID, CLIENT_002_ID],
    )
    await markRouteFeeReserved('route-001')

    await routeRequestService.acceptRouteRequest(request.id)

    const statuses = await query('SELECT id, status FROM group_offers WHERE id = ANY($1)', [
      [samePlanOfferId, unrelatedOfferId],
    ])
    const byId = new Map(statuses.rows.map((row) => [row.id, row.status]))
    assert.equal(byId.get(samePlanOfferId), 'closed')
    assert.equal(byId.get(unrelatedOfferId), 'pending')
  })

  it('rejects route request creation when plan is not owned by requesting client', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const plan = await planService.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-owner-src',
      dropoffWardId: 'ward-owner-dst',
      serviceDate: '2030-06-03',
      departureBlockStart: '2030-06-03T07:00:00.000Z',
      departureBlockEnd: '2030-06-03T07:30:00.000Z',
      passengerCount: 1,
    })
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-03',
          departureTime: '2030-06-03T07:00:00.000Z',
          tripPrice: 125000,
          distanceMeters: 10000,
        })
      ).id,
    )

    await assert.rejects(
      async () => routeRequestService.createRouteRequest(CLIENT_002_ID, plan.id, route.id),
      (err: unknown) => {
        assert.equal((err as { statusCode?: number }).statusCode, 403)
        return true
      },
    )

    const requestCount = await query(
      'SELECT COUNT(*)::int AS count FROM route_requests WHERE plan_id = $1 AND route_id = $2',
      [plan.id, route.id],
    )
    assert.equal(Number(requestCount.rows[0].count), 0)
  })

  it('rejects route request creation for non-published plans', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const plan = await planService.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10.77, lng: 106.7, label: 'Q1' },
      dropoff: { lat: 10.85, lng: 106.75, label: 'TD' },
      pickupWardId: 'ward-status-src',
      dropoffWardId: 'ward-status-dst',
      serviceDate: '2030-06-04',
      departureBlockStart: '2030-06-04T07:00:00.000Z',
      departureBlockEnd: '2030-06-04T07:30:00.000Z',
      passengerCount: 1,
    })
    await query('UPDATE plans SET status = $1 WHERE id = $2', ['canceled', plan.id])
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          serviceDate: '2030-06-04',
          departureTime: '2030-06-04T07:00:00.000Z',
          tripPrice: 126000,
          distanceMeters: 10000,
        })
      ).id,
    )

    await assert.rejects(
      async () => routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id),
      (err: unknown) => {
        assert.equal((err as { statusCode?: number }).statusCode, 409)
        return true
      },
    )
  })

  it('creates eligible offers while skipping existing same-direction candidates', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for idempotency tests')

    const firstPlanId = group.memberPlanIds[0]
    assert.ok(firstPlanId)
    const existing = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
    )
    assert.equal(existing.outcome, 'created')
    assert.ok(existing.offers.some((offer) => offer.planId === firstPlanId))

    await query('DELETE FROM group_offers WHERE plan_id <> $1 AND route_id = $2', [
      firstPlanId,
      'route-001',
    ])

    const result = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
    )

    assert.equal(result.outcome, 'created')
    assert.equal(result.createdCount, group.memberPlanIds.length - 1)
    assert.equal(result.skippedCount, 1)
    assert.equal(result.refreshHint, 'none')
    assert.equal(
      result.candidateResults?.find((candidate) => candidate.planId === firstPlanId)?.status,
      'skipped_existing',
    )
    assert.equal(
      result.candidateResults?.filter((candidate) => candidate.status === 'created').length,
      group.memberPlanIds.length - 1,
    )
  })

  it('returns no_new_requests and reuses pending parent on idempotent rerun', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for idempotency tests')

    const first = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
    )
    const second = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
    )

    assert.equal(second.groupRequest.id, first.groupRequest.id)
    assert.equal(second.outcome, 'no_new_requests')
    assert.equal(second.createdCount, 0)
    assert.equal(second.skippedCount, group.memberPlanIds.length)
    assert.equal(second.refreshHint, 'no_new_candidates')
    assert.deepEqual(second.offers, [])
    assert.equal(
      second.candidateResults?.every(
        (candidate) => candidate.status === 'skipped_existing',
      ),
      true,
    )

    const countRes = await query(
      'SELECT COUNT(*)::int AS count FROM group_offers WHERE route_id = $1 AND plan_id = ANY($2)',
      ['route-001', group.memberPlanIds],
    )
    assert.equal(Number(countRes.rows[0].count), group.memberPlanIds.length)
  })

  it('rejects all-skipped candidates without creating a zero-offer parent', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for idempotency tests')

    await query('UPDATE plans SET status = $1 WHERE id = ANY($2)', [
      'canceled',
      group.memberPlanIds,
    ])

    await assert.rejects(
      async () =>
        groupRequestRepository.createGroupRequestWithOffers({
          driverId: DRIVER_001_ID,
          routeId: 'route-001',
          demandGroupId: group.id,
          memberPlanIds: group.memberPlanIds,
        }),
      (err: unknown) => {
        const conflict = err as {
          statusCode?: number
          payload?: {
            outcome?: string
            createdCount?: number
            skippedCount?: number
            refreshHint?: string
          }
        }
        assert.equal(conflict.statusCode, 409)
        assert.equal(conflict.payload?.outcome, 'no_new_requests')
        assert.equal(conflict.payload?.createdCount, 0)
        assert.equal(conflict.payload?.skippedCount, group.memberPlanIds.length)
        assert.equal(conflict.payload?.refreshHint, 'no_new_candidates')
        return true
      },
    )

    const parentCount = await query(
      'SELECT COUNT(*)::int AS count FROM group_requests WHERE route_id = $1 AND demand_group_id = $2',
      ['route-001', group.id],
    )
    assert.equal(Number(parentCount.rows[0].count), 0)
  })

  it('requires route ownership before creating or reusing group parents', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for ownership tests')

    await assert.rejects(
      async () => groupRequestService.createGroupRequest(DRIVER_002_ID, 'route-001', group.id),
      (err: unknown) => {
        assert.equal((err as { statusCode?: number }).statusCode, 403)
        return true
      },
    )

    const parentCount = await query(
      'SELECT COUNT(*)::int AS count FROM group_requests WHERE route_id = $1 AND driver_id = $2',
      ['route-001', DRIVER_002_ID],
    )
    assert.equal(Number(parentCount.rows[0].count), 0)
  })

  it('reports accepted same-route group offers as skipped_matched', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((g) => g.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for accepted skip tests')

    const first = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
    )
    const acceptedPlanId = first.offers[0].planId
    await query('UPDATE group_offers SET status = $1 WHERE id = $2', [
      'accepted',
      first.offers[0].id,
    ])

    const second = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
    )

    assert.equal(
      second.offers.some((offer) => offer.planId === acceptedPlanId),
      false,
      'Accepted same-route group offer plan should not be re-offered',
    )
  })
})

// ─── 6.5 route exclusivity ────────────────────────────────────────────────────

describe('MVC request services route exclusivity', () => {
  before(async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(
      multiMemberGroup,
      'Need a multi-member group for exclusivity tests',
    )

    const result = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
    )
    await markRouteFeeReserved('route-001')
    await groupOfferService.acceptGroupOffer(result.offers[0].id)
  })

  it('rejects no-new candidates for a route with accepted offer without creating a parent', async () => {
    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups[0]
    assert.ok(group)

    await assert.rejects(
      async () => groupRequestService.createGroupRequest(DRIVER_001_ID, 'route-001', group.id),
      (err: unknown) => {
        const conflict = err as {
          statusCode?: number
          payload?: { outcome?: string; createdCount?: number; refreshHint?: string }
        }
        assert.equal(conflict.statusCode, 409)
        assert.equal(conflict.payload?.outcome, 'no_new_requests')
        assert.equal(conflict.payload?.createdCount, 0)
        assert.equal(conflict.payload?.refreshHint, 'no_new_candidates')
        return true
      },
    )
  })

  it('rejects search request acceptance for unavailable route', async () => {
    assert.equal(await driverRouteRepository.isRouteAvailable('route-001'), false)
    assert.equal(await driverRouteRepository.isRouteAvailable('route-002'), true)
  })

  it('accepted search request blocks group offer acceptance', async () => {
    // Create a search request for route-002
    const sreq = await routeRequestService.createRouteRequest(
      CLIENT_002_ID,
      'plan-004',
      'route-002',
    )
    assert.equal(sreq.status, 'pending')

    // Accept it
    await markRouteFeeReserved('route-002')
    const accepted = await routeRequestService.acceptRouteRequest(sreq.id)
    assert.equal(accepted.status, 'accepted')
    assert.equal(await driverRouteRepository.isRouteAvailable('route-002'), false)
  })
})

describe('ALI-84 matched journey cancellation reopening', () => {
  it('route cancel before plan end reopens the plan and leaves old pending closed', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('ali84-route-before', '2030-07-01T07:00:00.000Z', '2030-07-01T07:30:00.000Z')
    await markRouteFeeReserved(route.id)
    const plan = await createPlanAt(CLIENT_001_ID, 'ali84-plan-before', '2030-07-01T07:00:00.000Z', '2030-07-01T07:30:00.000Z')
    const competingRoute = await createPublishedRouteAt('ali84-route-closed', '2030-07-01T07:00:00.000Z', '2030-07-01T07:30:00.000Z')
    const closedRequest = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, competingRoute.id)
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await routeRequestService.acceptRouteRequest(request.id)

    await journeyService.cancelTrip(route.id)

    const statuses = await query(
      `SELECT (SELECT status FROM plans WHERE id = $1) AS plan_status,
              (SELECT status FROM route_requests WHERE id = $2) AS accepted_status,
              (SELECT status FROM route_requests WHERE id = $3) AS closed_status,
              (SELECT status FROM routes WHERE id = $4) AS route_status`,
      [plan.id, request.id, closedRequest.id, route.id],
    )
    assert.equal(statuses.rows[0].plan_status, 'published')
    assert.equal(statuses.rows[0].accepted_status, 'canceled')
    assert.equal(statuses.rows[0].closed_status, 'closed')
    assert.equal(statuses.rows[0].route_status, 'canceled')
  })

  it('route cancel after plan end cancels counterpart to avoid dangling matched plan', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('ali84-route-after', '2030-07-02T07:00:00.000Z', '2030-07-02T07:30:00.000Z')
    await markRouteFeeReserved(route.id)
    const plan = await createPlanAt(CLIENT_001_ID, 'ali84-plan-after', '2030-07-02T07:00:00.000Z', '2030-07-02T07:30:00.000Z')
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await routeRequestService.acceptRouteRequest(request.id)
    await query("UPDATE plans SET departure_block_end = NOW() - INTERVAL '1 minute' WHERE id = $1", [plan.id])

    await journeyService.cancelTrip(route.id)

    const statuses = await query(
      `SELECT (SELECT status FROM plans WHERE id = $1) AS plan_status,
              (SELECT status FROM routes WHERE id = $2) AS route_status,
              (SELECT status FROM route_requests WHERE id = $3) AS request_status`,
      [plan.id, route.id, request.id],
    )
    assert.equal(statuses.rows[0].plan_status, 'canceled')
    assert.equal(statuses.rows[0].route_status, 'canceled')
    assert.equal(statuses.rows[0].request_status, 'canceled')
  })

  it('plan cancel before route end reopens the route', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('ali84-plan-cancel-before', '2030-07-03T07:00:00.000Z', '2030-07-03T07:30:00.000Z')
    await markRouteFeeReserved(route.id)
    const plan = await createPlanAt(CLIENT_001_ID, 'ali84-route-reopen', '2030-07-03T07:00:00.000Z', '2030-07-03T07:30:00.000Z')
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await routeRequestService.acceptRouteRequest(request.id)

    await journeyService.cancelTrip(plan.id)

    const statuses = await query(
      `SELECT (SELECT status FROM routes WHERE id = $1) AS route_status,
              (SELECT status FROM plans WHERE id = $2) AS plan_status,
              (SELECT status FROM route_requests WHERE id = $3) AS request_status`,
      [route.id, plan.id, request.id],
    )
    assert.equal(statuses.rows[0].route_status, 'published')
    assert.equal(statuses.rows[0].plan_status, 'canceled')
    assert.equal(statuses.rows[0].request_status, 'canceled')
  })

  it('plan cancel after route end cancels counterpart to avoid dangling matched route', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('ali84-plan-cancel-after', '2030-07-05T07:00:00.000Z', '2030-07-05T07:30:00.000Z')
    await markRouteFeeReserved(route.id)
    const plan = await createPlanAt(CLIENT_001_ID, 'ali84-route-after', '2030-07-05T07:00:00.000Z', '2030-07-05T07:30:00.000Z')
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await routeRequestService.acceptRouteRequest(request.id)
    await query("UPDATE routes SET window_end = NOW() - INTERVAL '1 minute' WHERE id = $1", [route.id])

    await journeyService.cancelTrip(plan.id)

    const statuses = await query(
      `SELECT (SELECT status FROM routes WHERE id = $1) AS route_status,
              (SELECT status FROM plans WHERE id = $2) AS plan_status,
              (SELECT status FROM route_requests WHERE id = $3) AS request_status`,
      [route.id, plan.id, request.id],
    )
    assert.equal(statuses.rows[0].route_status, 'canceled')
    assert.equal(statuses.rows[0].plan_status, 'canceled')
    assert.equal(statuses.rows[0].request_status, 'canceled')
  })

  it('route cancel after accepted group offer cancels offer parent and reopens future plan', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('ali84-group-offer-route', '2030-07-06T07:00:00.000Z', '2030-07-06T07:30:00.000Z')
    await markRouteFeeReserved(route.id)
    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((candidate) => candidate.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for group offer cancel test')

    const result = await groupRequestService.createGroupRequest(DRIVER_001_ID, route.id, group.id)
    assert.ok(result.offers.length > 0, 'Should create at least one pending group offer')
    const accepted = await groupOfferService.acceptGroupOffer(result.offers[0].id)

    await journeyService.cancelTrip(route.id)

    const statuses = await query(
      `SELECT (SELECT status FROM routes WHERE id = $1) AS route_status,
              (SELECT status FROM plans WHERE id = $2) AS plan_status,
              (SELECT status FROM group_offers WHERE id = $3) AS offer_status,
              (SELECT status FROM group_requests WHERE id = $4) AS parent_status`,
      [route.id, accepted.planId, accepted.id, result.groupRequest.id],
    )
    assert.equal(statuses.rows[0].route_status, 'canceled')
    assert.equal(statuses.rows[0].plan_status, 'published')
    assert.equal(statuses.rows[0].offer_status, 'canceled')
    assert.equal(statuses.rows[0].parent_status, 'canceled')
  })

  it('plan cancel after reciprocal linked match cancels linked facts and offer parent', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await groupRequestRepository.deriveDemandGroups()
    const group = groups.find((candidate) => candidate.memberCount > 1)
    assert.ok(group, 'Need a multi-member group for reciprocal cancel test')
    const planId = group.memberPlanIds[0]
    assert.ok(planId)
    const planRes = await query('SELECT client_id FROM plans WHERE id = $1', [planId])
    const clientId = planRes.rows[0]?.client_id
    assert.ok(clientId)

    const routeRequest = await routeRequestService.createRouteRequest(clientId, planId, 'route-001')
    await markRouteFeeReserved('route-001')
    const groupSend = await groupRequestService.createGroupRequest(DRIVER_001_ID, 'route-001', group.id)
    assert.equal(groupSend.outcome, 'matched')
    assert.ok(groupSend.matchedOffer)

    await journeyService.cancelTrip(planId)

    const statuses = await query(
      `SELECT (SELECT status FROM plans WHERE id = $1) AS plan_status,
              (SELECT status FROM routes WHERE id = $2) AS route_status,
              (SELECT status FROM route_requests WHERE id = $3) AS request_status,
              (SELECT status FROM group_offers WHERE id = $4) AS offer_status,
              (SELECT status FROM group_requests WHERE id = $5) AS parent_status`,
      [planId, 'route-001', routeRequest.id, groupSend.matchedOffer.id, groupSend.groupRequest.id],
    )
    assert.equal(statuses.rows[0].plan_status, 'canceled')
    assert.equal(statuses.rows[0].route_status, 'published')
    assert.equal(statuses.rows[0].request_status, 'canceled')
    assert.equal(statuses.rows[0].offer_status, 'canceled')
    assert.equal(statuses.rows[0].parent_status, 'canceled')
  })

  it('reopened plan can match again after accepted facts are canceled', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await createPublishedRouteAt('ali84-rematch-old', '2030-07-04T07:00:00.000Z', '2030-07-04T07:30:00.000Z')
    await markRouteFeeReserved(route.id)
    const plan = await createPlanAt(CLIENT_001_ID, 'ali84-rematch-plan', '2030-07-04T07:00:00.000Z', '2030-07-04T07:30:00.000Z')
    const request = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
    await routeRequestService.acceptRouteRequest(request.id)
    await journeyService.cancelTrip(route.id)

    const nextRoute = await createPublishedRouteAt('ali84-rematch-new', '2030-07-04T07:00:00.000Z', '2030-07-04T07:30:00.000Z')
    await markRouteFeeReserved(nextRoute.id)
    const nextRequest = await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, nextRoute.id)
    const acceptedAgain = await routeRequestService.acceptRouteRequest(nextRequest.id)

    assert.equal(acceptedAgain.status, 'accepted')
    const planRes = await query('SELECT status FROM plans WHERE id = $1', [plan.id])
    assert.equal(planRes.rows[0].status, 'matched')
  })
})

// ─── 6.6 search request plan linkage ──────────────────────────────────────────
