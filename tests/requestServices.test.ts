import assert from 'node:assert/strict'
import { after, before, describe, it as nodeIt } from 'node:test'

import { query } from '../src/db/connection'
import * as matching from '../src/matching'
import * as carService from '../src/services/carService'
import * as driverRouteRepository from '../src/repositories/driverRouteRepository'
import * as driverRouteService from '../src/services/driverRouteService'
import * as groupOfferService from '../src/services/groupOfferService'
import * as demandGroupRepository from '../src/repositories/demandGroupRepository'
import * as groupRequestRepository from '../src/repositories/groupRequestRepository'
import * as groupRequestService from '../src/services/groupRequestService'
import * as journeyRepository from '../src/repositories/journeyRepository'
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
          departureWindowStartDate: '2030-06-01T07:00:00.000Z',
          departureWindowEndDate: '2030-06-01T07:30:00.000Z',
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
          departureWindowStartDate: '2030-06-02T07:00:00.000Z',
          departureWindowEndDate: '2030-06-02T07:30:00.000Z',
          tripPrice: 120000,
            distanceMeters: 10000,
        })
      ).id,
    )
    const olderPlan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-order-old',
      destinationWardId: 'ward-order-old-dest',
      departureWindowStartDate: '2030-06-01T07:00:00.000Z',
      departureWindowEndDate: '2030-06-01T07:30:00.000Z',
      passengerCount: 1,
    })
    const newerPlan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-order-new',
      destinationWardId: 'ward-order-new-dest',
      departureWindowStartDate: '2030-06-02T07:00:00.000Z',
      departureWindowEndDate: '2030-06-02T07:30:00.000Z',
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

    const groups = await demandGroupRepository.deriveDemandGroups()
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

// ─── 6.5 route exclusivity ────────────────────────────────────────────────────

describe('MVC request services route exclusivity', () => {
  before(async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await demandGroupRepository.deriveDemandGroups()
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

  it('rejects new group requests for a route with accepted offer', async () => {
    const groups = await demandGroupRepository.deriveDemandGroups()
    const group = groups[0]
    assert.ok(group)

    await assert.rejects(
      async () =>
        await groupRequestService.createGroupRequest(DRIVER_002_ID, 'route-001', group.id),
      /not available/,
      'Should reject group request for unavailable route',
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

// ─── 6.6 search request plan linkage ──────────────────────────────────────────
