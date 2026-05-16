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


describe('MVC user and car service CRUD operations', () => {
  it('users CRUD behaves correctly', async () => {
    const user = await userService.getUser(DRIVER_001_ID)
    assert.ok(user)
    assert.equal(user.displayName, 'Tài xế 001')

    const updated = await userService.setUserMode(user.identityId!, 'client')
    assert.equal(updated!.identity.preferredMode, 'client')
    assert.ok(updated!.identity.modeSelectedAt)

    const mode = await userService.getUserMode(user.identityId!)
    assert.equal(mode!.preferredMode, 'client')
  })

  it('cars CRUD behaves correctly', async () => {
    const car = await carService.createCar(DRIVER_001_ID, {
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

    const cars = await carService.listCarsByOwner(DRIVER_001_ID)
    assert.ok(cars.find((c) => c.id === car.id))

    const updated = await carService.updateCar(car.id, { color: 'Blue' })
    assert.equal(updated!.color, 'Blue')

    const deleted = await carService.deleteCar(car.id)
    assert.ok(deleted)
  })
})
