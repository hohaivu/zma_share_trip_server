import assert from 'node:assert/strict'
import { after, before, describe, it as nodeIt } from 'node:test'

import { query } from '../src/db/connection'
import * as matching from '../src/matching'
import { HttpError } from '../src/http-error'
import * as carService from '../src/services/carService'
import * as driverRouteRepository from '../src/repositories/driverRouteRepository'
import * as driverRouteService from '../src/services/driverRouteService'
import * as groupOfferService from '../src/services/groupOfferService'
import * as demandGroupRepository from '../src/repositories/demandGroupRepository'
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

describe('wallet service fee calculation', () => {
  nodeIt('computes route fee using rounded-up per-km pricing', () => {
    const previousFeeRate = process.env.WALLET_FEE_VND_PER_KM
    process.env.WALLET_FEE_VND_PER_KM = '333'
    try {
      assert.equal(walletService.computeRouteFeeRequiredVnd(1000), 333)
      assert.equal(walletService.computeRouteFeeRequiredVnd(1001), 334)
      assert.equal(walletService.computeRouteFeeRequiredVnd(2500), 833)
    } finally {
      if (previousFeeRate === undefined) {
        delete process.env.WALLET_FEE_VND_PER_KM
      } else {
        process.env.WALLET_FEE_VND_PER_KM = previousFeeRate
      }
    }
  })

  nodeIt('rejects invalid route distances with client-facing HttpErrors', () => {
    assert.throws(() => walletService.computeRouteFeeRequiredVnd(0), {
      constructor: HttpError,
      statusCode: 400,
      message: 'distanceMeters must be a positive integer',
    })
    assert.throws(() => walletService.computeRouteFeeRequiredVnd(Number.NaN), {
      constructor: HttpError,
      statusCode: 400,
      message: 'distanceMeters must be a positive integer',
    })
    assert.throws(() => walletService.computeRouteFeeRequiredVnd(1.5), {
      constructor: HttpError,
      statusCode: 400,
      message: 'distanceMeters must be a whole number',
    })
  })
})


describe('MVC wallet-gated driver route publishing', () => {
  it('publishing a draft reserves the route fee and appends a ledger entry', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await driverRouteService.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureWindowStartDate: '2030-04-30T07:00:00.000Z',
      departureWindowEndDate: '2030-04-30T07:00:00.000Z',
      tripPrice: 100000,
      distanceMeters: 10000,
    })

    const published = await driverRouteService.publishRoute(route.id)
    const wallet = await walletService.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await walletService.listDriverWalletTransactions(
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

    const route = await driverRouteService.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureWindowStartDate: '2030-05-01T07:00:00.000Z',
      departureWindowEndDate: '2030-05-01T07:00:00.000Z',
      tripPrice: 120000,
      distanceMeters: 10000,
    })

    await assert.rejects(
      async () => driverRouteService.publishRoute(route.id),
      /Insufficient wallet balance/,
    )

    const persisted = await driverRouteService.getRoute(route.id)
    const wallet = await walletService.getDriverWalletSummary(DRIVER_001_ID)

    assert.equal(persisted?.status, 'draft')
    assert.equal(persisted?.walletFeeStatus, 'none')
    assert.equal(wallet.balanceVnd, 100)
    assert.equal(wallet.reservedBalanceVnd, 0)
  })

  it('rejects in-place edits to fee-bearing fields after publish', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await driverRouteService.createRoute(DRIVER_001_ID, {
      carId: 'car-001',
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      departureWindowStartDate: '2030-05-02T07:00:00.000Z',
      departureWindowEndDate: '2030-05-02T07:00:00.000Z',
      tripPrice: 130000,
      distanceMeters: 12000,
    })

    await driverRouteService.publishRoute(route.id)

    await assert.rejects(
      async () =>
        driverRouteService.updateRoute(route.id, {
          distanceMeters: 14000,
        }),
      /Published fee-bearing route fields cannot be edited/,
    )
  })
})

describe('MVC wallet-gated accept and cancel transitions', () => {
  it('canceling a group request closes offers without charging wallet', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureWindowStartDate: '2030-03-20T00:00:00.000Z',
          departureWindowEndDate: '2030-03-20T00:30:00.000Z',
          tripPrice: 130000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const groups = await demandGroupRepository.deriveDemandGroups({
      start: route.departureWindowStartDate,
      end: route.departureWindowEndDate,
    })
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(multiMemberGroup)
    const request = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      route.id,
      multiMemberGroup!.id,
      multiMemberGroup!.memberPlanIds,
    )

    const canceled = await groupRequestService.cancelGroupRequest(request.groupRequest.id)
    const offers = await journeyRepository.listGroupOffersByRoute(route.id)
    const wallet = await walletService.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await walletService.listDriverWalletTransactions(DRIVER_001_ID, 20)

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

    const declinedRoute = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureWindowStartDate: '2030-06-04T07:00:00.000Z',
          departureWindowEndDate: '2030-06-04T07:00:00.000Z',
          tripPrice: 140000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const canceledRoute = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureWindowStartDate: '2030-06-05T07:00:00.000Z',
          departureWindowEndDate: '2030-06-05T07:00:00.000Z',
          tripPrice: 150000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const declinedRequest = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      declinedRoute.id,
    )
    const canceledRequest = await routeRequestService.createRouteRequest(
      CLIENT_002_ID,
      'plan-002',
      canceledRoute.id,
    )

    const declined = await routeRequestService.declineRouteRequest(declinedRequest.id)
    const canceled = await routeRequestService.cancelRouteRequest(canceledRequest.id)
    const wallet = await walletService.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await walletService.listDriverWalletTransactions(DRIVER_001_ID, 20)

    assert.equal(declined.status, 'declined')
    assert.equal(canceled.status, 'canceled')
    assert.equal(wallet.balanceVnd, 500000)
    assert.equal(wallet.reservedBalanceVnd, 10000)
    assert.equal(transactions.some((tx) => tx.type === 'charge'), false)
  })

  it('charges the route fee once when accepting a group offer and ignores retries', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureWindowStartDate: '2030-03-20T00:00:00.000Z',
          departureWindowEndDate: '2030-03-20T00:30:00.000Z',
          tripPrice: 140000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const groups = await demandGroupRepository.deriveDemandGroups({
      start: route.departureWindowStartDate,
      end: route.departureWindowEndDate,
    })
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(
      multiMemberGroup,
      'Need a multi-member group for group-offer test',
    )

    const groupRequest = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      route.id,
      multiMemberGroup!.id,
      multiMemberGroup!.memberPlanIds,
    )

    const winnerId = groupRequest.offers[0].id
    const accepted = await groupOfferService.acceptGroupOffer(winnerId)
    const retry = await groupOfferService.acceptGroupOffer(winnerId)
    const wallet = await walletService.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await walletService.listDriverWalletTransactions(
      DRIVER_001_ID,
      20,
    )

    assert.equal(accepted.status, 'accepted')
    assert.equal(retry.status, 'accepted')
    assert.equal((await driverRouteService.getRoute(route.id))?.status, 'matched')
    assert.equal((await planService.getPlan(accepted.planId!))?.status, 'matched')
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

    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureWindowStartDate: '2030-05-04T07:00:00.000Z',
          departureWindowEndDate: '2030-05-04T07:00:00.000Z',
          tripPrice: 150000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const request = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      'plan-001',
      route.id,
    )

    const accepted = await routeRequestService.acceptRouteRequest(request.id)
    const retry = await routeRequestService.acceptRouteRequest(request.id)
    const wallet = await walletService.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await walletService.listDriverWalletTransactions(
      DRIVER_001_ID,
      20,
    )

    assert.equal(accepted.status, 'accepted')
    assert.equal(retry.status, 'accepted')
    assert.equal((await driverRouteService.getRoute(route.id))?.status, 'matched')
    assert.equal((await planService.getPlan(request.planId!))?.status, 'matched')
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

    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureWindowStartDate: '2030-05-05T07:00:00.000Z',
          departureWindowEndDate: '2030-05-05T07:00:00.000Z',
          tripPrice: 160000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const canceled = await journeyService.cancelTrip(route.id)
    const wallet = await walletService.getDriverWalletSummary(DRIVER_001_ID)
    const transactions = await walletService.listDriverWalletTransactions(
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

    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
      originWardId: 'ward-cancel-plan',
      destinationWardId: 'ward-cancel-plan-dest',
      departureWindowStartDate: '2030-05-06T07:00:00.000Z',
      departureWindowEndDate: '2030-05-06T07:30:00.000Z',
      passengerCount: 1,
    })
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
          destination: { lat: 10.85, lng: 106.75, label: 'TD' },
          departureWindowStartDate: '2030-05-06T07:00:00.000Z',
          departureWindowEndDate: '2030-05-06T07:00:00.000Z',
          tripPrice: 170000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const request = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )
    await routeRequestService.acceptRouteRequest(request.id)

    const canceled = await journeyService.cancelTrip(plan.id)
    const wallet = await walletService.getDriverWalletSummary(DRIVER_001_ID)
    const canceledRequest = await query(
      'SELECT status FROM route_requests WHERE id = $1',
      [request.id],
    )
    const transactions = await walletService.listDriverWalletTransactions(
      DRIVER_001_ID,
      20,
    )

    assert.equal(canceled.status, 'canceled')
    assert.equal((canceled as Plan).status, 'canceled')
    assert.equal(wallet.balanceVnd, 500000)
    assert.equal(wallet.reservedBalanceVnd, 0)
    assert.equal(canceledRequest.rows[0]?.status, 'canceled')
    assert.equal(
      transactions.filter((tx) => tx.type === 'refund').length,
      1,
      'Route fee should be refunded exactly once',
    )
    assert.equal(transactions[0]?.type, 'refund')
    assert.equal(transactions[0]?.routeId, route.id)
  })
})
