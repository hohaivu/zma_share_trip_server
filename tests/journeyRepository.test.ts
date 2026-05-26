import assert from 'node:assert/strict'
import { after, before, describe, it as nodeIt } from 'node:test'

import { query } from '../src/db/connection'
import * as demandGroupRepository from '../src/repositories/demandGroupRepository'
import * as matching from '../src/matching'
import * as carService from '../src/services/carService'
import * as driverRouteRepository from '../src/repositories/driverRouteRepository'
import * as driverRouteService from '../src/services/driverRouteService'
import * as groupOfferService from '../src/services/groupOfferService'
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

const it = createDbTest('MariaDB unavailable for DB-backed MVC module tests')
const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const DRIVER_002_ID = 'a1b2c3d4-0002-4000-8000-000000000002'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'
const CLIENT_002_ID = 'a1b2c3d4-0004-4000-8000-000000000004'
const TERMINAL_SEARCH_REQUEST_STATUSES = [
  'declined',
  'closed',
  'expired',
] as const

// Note: require resets are not trivial in CJS, so tests use the shared
// MVC module graph. Tests should not depend on ordering within a describe block.

before(async () => {
  await setupTestDb()
})

after(async () => {
  await teardownTestDb()
})

// ─── 6.1 deriveDemandGroups ────────────────────────────────────────────────────


describe('MVC journey repository route and plan helpers', () => {
  it('links requests to routes and plans and manages saved locations', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const request = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    const routeRequests = await journeyRepository.listRouteRequestsByRoute('route-002')
    const planRequests = await journeyRepository.listRouteRequestsByPlan('plan-001')
    const saved = await journeyRepository.createSavedLocation({
      label: 'MVC saved place',
      lat: 10.77,
      lng: 106.7,
    })

    assert.equal(routeRequests.some((item) => item.id === request.id), true)
    assert.equal(planRequests.some((item) => item.id === request.id), true)
    assert.equal(
      (await journeyRepository.listSavedLocations()).some(
        (item) => item.id === saved.id,
      ),
      true,
    )
    assert.equal(await journeyRepository.deleteSavedLocation(saved.id), true)
  })
})

// ─── 6.8 CRUD coverage ────────────────────────────────────────────────────────

async function markRouteFeeReserved(routeId: string): Promise<void> {
  await query(
    "UPDATE routes SET wallet_fee_status = 'reserved', fee_required_vnd = COALESCE(fee_required_vnd, 0) WHERE id = $1",
    [routeId],
  )
}

// ─── Cancel cascade: unmatched route (task 5.5) ───────────────────────────────

describe('cascade decline — unmatched route cancel', () => {
  it('declines pending group_offers and route_requests when unmatched route is canceled', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await demandGroupRepository.deriveDemandGroups()
    const group = groups[0]
    assert.ok(group)

    const { offers } = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
      group.memberPlanIds.slice(0, 1),
    )

    const rr = await routeRequestService.createRouteRequest(
      CLIENT_002_ID,
      'plan-004',
      'route-001',
    )

    await journeyRepository.cancelTripTx('route-001')

    const goRes = await query('SELECT status FROM group_offers WHERE id = $1', [offers[0].id])
    const rrRes = await query('SELECT status FROM route_requests WHERE id = $1', [rr.id])
    assert.equal(goRes.rows[0]?.status, 'declined', 'group_offer should be declined on route cancel')
    assert.equal(rrRes.rows[0]?.status, 'declined', 'route_request should be declined on route cancel')
  })
})

// ─── Cancel cascade: unmatched plan (task 5.6) ────────────────────────────────

describe('cascade decline — unmatched plan cancel', () => {
  it('declines pending group_offers and route_requests when unmatched plan is canceled', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const rr = await routeRequestService.createRouteRequest(CLIENT_001_ID, 'plan-001', 'route-001')
    assert.equal(rr.planId, 'plan-001')

    const groups = await demandGroupRepository.deriveDemandGroups()
    const groupWithPlan001 = groups.find((g) => g.memberPlanIds.includes('plan-001'))
    assert.ok(groupWithPlan001, 'Need a demand group containing plan-001')

    const { offers } = await groupRequestService.createGroupRequest(
      DRIVER_002_ID,
      'route-002',
      groupWithPlan001.id,
      ['plan-001'],
    )

    await journeyRepository.cancelTripTx('plan-001')

    const rrRes = await query('SELECT status FROM route_requests WHERE id = $1', [rr.id])
    const goRes = await query('SELECT status FROM group_offers WHERE id = $1', [offers[0].id])
    assert.equal(rrRes.rows[0]?.status, 'declined', 'route_request should be declined on plan cancel')
    assert.equal(goRes.rows[0]?.status, 'declined', 'group_offer should be declined on plan cancel')
  })
})

// ─── Cancel cascade: matched trip does not re-decline (task 5.7) ─────────────

describe('cascade decline — matched-trip cancel does not re-decline terminal siblings', () => {
  it('cancels accepted match without touching already-declined siblings', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const groups = await demandGroupRepository.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(multiMemberGroup)

    const { offers } = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
      multiMemberGroup.memberPlanIds,
    )
    assert.ok(offers.length >= 2)

    await markRouteFeeReserved('route-001')
    const accepted = await groupOfferService.acceptGroupOffer(offers[0].id)
    assert.equal(accepted.status, 'accepted')

    const siblingBefore = await query('SELECT status FROM group_offers WHERE id = $1', [offers[1].id])
    assert.equal(siblingBefore.rows[0]?.status, 'declined')

    await journeyRepository.cancelTripTx('route-001')

    const acceptedAfter = await query('SELECT status FROM group_offers WHERE id = $1', [offers[0].id])
    assert.equal(acceptedAfter.rows[0]?.status, 'canceled', 'accepted offer should be canceled')

    const siblingAfter = await query('SELECT status FROM group_offers WHERE id = $1', [offers[1].id])
    assert.equal(siblingAfter.rows[0]?.status, 'declined', 'already-declined sibling must not change')
  })
})

