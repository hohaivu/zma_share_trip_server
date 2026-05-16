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

