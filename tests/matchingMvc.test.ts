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

// Note: require resets are not trivial in CJS, so tests use the shared
// MVC module graph. Tests should not depend on ordering within a describe block.

before(async () => {
  await setupTestDb()
})

after(async () => {
  await teardownTestDb()
})

// ─── 6.1 deriveDemandGroups ────────────────────────────────────────────────────


describe('MVC matching service demand-group classification', () => {
  it('returns exact_3 for route matching demand group ward/block', async () => {
    const results = await matching.computeMatchedDemandGroups('route-001')
    const exact = results.filter((r) => r.matchTier === 'exact_3')
    assert.ok(exact.length > 0, 'Should have at least one exact_3 match')
  })

  it('returns results with tripPrice from route', async () => {
    const results = await matching.computeMatchedDemandGroups('route-001')
    for (const r of results) {
      assert.equal(r.tripPrice, 120000, 'Should carry route tripPrice')
      assert.equal(typeof r.originDistanceKm, 'number')
      assert.equal(typeof r.destinationDistanceKm, 'number')
    }
  })

  it('returns empty for non-existent route', async () => {
    const results = await matching.computeMatchedDemandGroups('route-999')
    assert.deepEqual(results, [])
  })
})

// ─── 6.3 visibility mode ──────────────────────────────────────────────────────

describe('MVC matching visibility helper', () => {
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
