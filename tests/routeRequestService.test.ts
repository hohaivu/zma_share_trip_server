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


describe('MVC route request service plan linkage', () => {
  before(async () => {
    await setupTestDb()
    if (!isDbAvailable()) return
  })

  it('accepts grouped plan linkage when provided', async () => {
    await setupTestDb()
    const sreq = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    assert.equal(sreq.status, 'pending')
    assert.equal(sreq.planId, 'plan-001')
  })

  it('rejects unknown plan linkage', async () => {
    await setupTestDb()
    await assert.rejects(
      async () =>
        await routeRequestService.createRouteRequest(
          CLIENT_001_ID,
          'plan-missing',
          'route-002',
        ),
      /Plan not found/,
      'Unknown planId should fail validation',
    )
  })

  it('rejects search requests without plan linkage', async () => {
    await setupTestDb()
    await assert.rejects(
      async () =>
        await routeRequestService.createRouteRequest(
          CLIENT_001_ID,
          null as unknown as string,
          'route-002',
        ),
      /Plan not found/,
    )
  })
})

// ─── 6.7 Single active search requests ──────────────────────────────────────────
describe('MVC route request service single active invariant', () => {
  before(async () => {
    await setupTestDb()
    if (!isDbAvailable()) return
  })

  it('rejects duplicate active search requests for same route and client', async () => {
    const sreq1 = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    assert.equal(sreq1.status, 'pending')

    await assert.rejects(
      async () =>
        await routeRequestService.createRouteRequest(CLIENT_001_ID, 'plan-001', 'route-002'),
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
      const route = await driverRouteService.createRoute(DRIVER_001_ID, {
        carId: 'car-001',
        origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
        destination: { lat: 10.85, lng: 106.75, label: 'TD' },
        serviceDate: `2030-04-2${terminalStatus.length}`,
        departureTime: `2030-04-2${terminalStatus.length}T07:00:00.000Z`,
        tripPrice: 100000,
        distanceMeters: 10000,
      })
      await driverRouteService.publishRoute(route.id)
      const initialRequest = await routeRequestService.createRouteRequest(
        CLIENT_001_ID,
        'plan-001',
        route.id,
      )

      await query('UPDATE route_requests SET status = $1 WHERE id = $2', [
        terminalStatus,
        initialRequest.id,
      ])

      const resentRequest = await routeRequestService.createRouteRequest(
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
