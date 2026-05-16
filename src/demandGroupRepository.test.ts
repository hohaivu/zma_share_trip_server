import assert from 'node:assert/strict'
import { after, before, describe, it as nodeIt } from 'node:test'

import { query } from './db/connection'
import * as matching from './matching'
import * as carService from './services/carService'
import * as driverRouteRepository from './repositories/driverRouteRepository'
import * as driverRouteService from './services/driverRouteService'
import * as groupOfferService from './services/groupOfferService'
import * as groupRequestRepository from './repositories/groupRequestRepository'
import * as groupRequestService from './services/groupRequestService'
import * as journeyRepository from './repositories/journeyRepository'
import { journeyService } from './services/journeyService'
import * as planService from './services/planService'
import * as routeRequestService from './services/routeRequestService'
import * as userService from './services/userService'
import * as walletService from './services/walletService'
import {
  createDbTest,
  isDbAvailable,
  setupTestDb,
  teardownTestDb,
} from './test-db'
import { Plan, Route } from './types/entities'

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


describe('MVC demand group repository derivation', () => {
  it('groups plans by serviceDate + ward pair + departure block', async () => {
    const groups = await groupRequestRepository.deriveDemandGroups()
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
    const planA = await planService.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10, lng: 106, label: 'A' },
      dropoff: { lat: 11, lng: 106, label: 'B' },
      pickupWardId: 'ward-utc',
      dropoffWardId: 'ward-utc-dest',
      serviceDate: '2030-05-05',
      departureBlockStart: '2030-05-05T14:00:00.000+07:00', // mapped to 07:00Z
      departureBlockEnd: '2030-05-05T14:30:00.000+07:00',
      passengerCount: 1,
    })
    const planB = await planService.createPlan(CLIENT_002_ID, {
      pickup: { lat: 10, lng: 106, label: 'A' },
      dropoff: { lat: 11, lng: 106, label: 'B' },
      pickupWardId: 'ward-utc',
      dropoffWardId: 'ward-utc-dest',
      serviceDate: '2030-05-05',
      departureBlockStart: '2030-05-05T07:00:00.000Z',
      departureBlockEnd: '2030-05-05T07:30:00.000Z',
      passengerCount: 2,
    })

    const groups = await groupRequestRepository.deriveDemandGroups()
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
    const groups = await groupRequestRepository.deriveDemandGroups()
    const tbGroup = groups.find((g) => g.pickupWardId === 'ward-tb-p15')
    assert.ok(tbGroup, 'Should find Tan Binh group')
    assert.equal(tbGroup.memberCount, 1, 'Single-member group')
    assert.equal(tbGroup.totalPassengerCount, 1)
  })

  it('excludes accepted plans from other routes and recalculates group counts', async () => {
    await setupTestDb()

    const before = await groupRequestRepository.deriveDemandGroups()
    const target = before.find(
      (group) =>
        group.pickupWardId === 'ward-q1-bennghe' &&
        group.dropoffWardId === 'ward-td-binhtho' &&
        group.serviceDate === '2030-03-20',
    )
    assert.ok(target)
    assert.equal(target.memberCount, 2)
    assert.equal(target.totalPassengerCount, 3)

    const request = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    await markRouteFeeReserved('route-002')
    await routeRequestService.acceptRouteRequest(request.id)

    const after = await groupRequestRepository.deriveDemandGroups()
    const recalculated = after.find((group) => group.id === target.id)
    assert.ok(recalculated)
    assert.equal(recalculated.memberCount, 1)
    assert.equal(recalculated.totalPassengerCount, 2)
    assert.deepEqual(recalculated.memberPlanIds, ['plan-002'])
  })

  it('omits emptied groups from matched-demand results', async () => {
    await setupTestDb()

    const targetRoute = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
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
    const acceptedElsewhereRoute = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_002_ID, {
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
    const plan = await planService.createPlan(CLIENT_001_ID, {
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

    const request = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      acceptedElsewhereRoute.id,
    )
    await markRouteFeeReserved(acceptedElsewhereRoute.id)
    await routeRequestService.acceptRouteRequest(request.id)

    const after = await matching.computeMatchedDemandGroups(targetRoute.id)
    assert.equal(
      after.some((group) => group.pickupWardId === 'ward-exclusive'),
      false,
    )
  })

  it('persists grouped publish mode for newly created plans', async () => {
    const plan = await planService.createPlan(CLIENT_001_ID, {
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

    const initial = await groupRequestRepository.deriveDemandGroups()
    const target = initial.find(
      (group) =>
        group.pickupWardId === 'ward-q1-bennghe' &&
        group.dropoffWardId === 'ward-td-binhtho' &&
        group.serviceDate === '2030-03-20',
    )
    assert.ok(target)
    assert.equal(target.memberCount, 2)

    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_002_ID, {
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

    const request = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      route.id,
    )
    await markRouteFeeReserved(route.id)
    await routeRequestService.acceptRouteRequest(request.id)

    const suppressed = await groupRequestRepository.deriveDemandGroups()
    const suppressedTarget = suppressed.find((group) => group.id === target.id)
    assert.ok(suppressedTarget)
    assert.equal(suppressedTarget.memberCount, 1)

    await journeyService.cancelTrip(route.id)

    const restored = await groupRequestRepository.deriveDemandGroups()
    const restoredTarget = restored.find((group) => group.id === target.id)
    assert.ok(restoredTarget)
    assert.equal(restoredTarget.memberCount, 1)
    assert.equal(restoredTarget.totalPassengerCount, 2)
  })
})
