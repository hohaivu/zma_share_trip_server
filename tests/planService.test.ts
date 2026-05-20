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


describe('MVC plan service client cancellation', () => {
  it('cancels an owned unpublished-pairing plan and removes it from work queue and demand', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-client-cancel',
      destinationWardId: 'ward-client-cancel-dest',
      departureWindowStartDate: '2030-05-07T07:00:00.000Z',
      departureWindowEndDate: '2030-05-07T07:30:00.000Z',
      passengerCount: 1,
    })

    const before = await demandGroupRepository.deriveDemandGroups()
    assert.equal(
      before.some((group) => group.memberPlanIds.includes(plan.id)),
      true,
    )

    const canceled = await planService.cancelPlanByClient(plan.id, CLIENT_001_ID)
    const clientPlans = await planService.listPlansByClient(CLIENT_001_ID)
    const after = await demandGroupRepository.deriveDemandGroups()

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
      () => planService.cancelPlanByClient('plan-001', CLIENT_002_ID),
      (err: unknown) =>
        err instanceof Error && 'statusCode' in err && err.statusCode === 403,
    )
  })

  it('throws 404 for a missing plan', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    await assert.rejects(
      () => planService.cancelPlanByClient('plan-missing', CLIENT_001_ID),
      (err: unknown) =>
        err instanceof Error && 'statusCode' in err && err.statusCode === 404,
    )
  })

  it('rejects plan cancellation when search request is accepted', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const request = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    await markRouteFeeReserved('route-002')
    await routeRequestService.acceptRouteRequest(request.id)

    await assert.rejects(
      () => planService.cancelPlanByClient('plan-001', CLIENT_001_ID),
      (err: unknown) =>
        err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    )
  })

  it('rejects plan cancellation when group offer is accepted', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await demandGroupRepository.deriveDemandGroups()
    const multiMemberGroup = groups.find((group) => group.memberCount > 1)
    assert.ok(multiMemberGroup)
    const result = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
    )
    const targetOffer = result.offers.find(
      (offer) => offer.clientId === CLIENT_001_ID,
    )
    assert.ok(targetOffer)
    await markRouteFeeReserved('route-001')
    await groupOfferService.acceptGroupOffer(targetOffer.id)

    await assert.rejects(
      () => planService.cancelPlanByClient(targetOffer.planId, CLIENT_001_ID),
      (err: unknown) =>
        err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    )
  })
})

// ─── 6.2 exact-3 / near-3 classification ──────────────────────────────────────
