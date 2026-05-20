import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import * as matching from '../src/matching'
import { query } from '../src/db/connection'
import * as driverRouteService from '../src/services/driverRouteService'
import * as groupOfferService from '../src/services/groupOfferService'
import * as groupRequestService from '../src/services/groupRequestService'
import * as planService from '../src/services/planService'
import * as routeRequestService from '../src/services/routeRequestService'
import * as userService from '../src/services/userService'
import { createDbTest, setupTestDb, teardownTestDb } from '../src/test-db'
import { User } from '../src/types/entities'

const itDb = createDbTest('Postgres unavailable for DB-backed matching tests')
const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'

async function markRouteFeeReserved(routeId: string): Promise<void> {
  await query(
    "UPDATE routes SET wallet_fee_status = 'reserved', fee_required_vnd = COALESCE(fee_required_vnd, 0) WHERE id = $1",
    [routeId],
  )
}

before(async () => {
  await setupTestDb()
})

after(async () => {
  await teardownTestDb()
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

// HCM City reference points
const Q1_PICKUP = { lat: 10.7769, lng: 106.7009, label: 'Quận 1' }
const TD_DROPOFF = { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' }
const TB_PICKUP = { lat: 10.8, lng: 106.65, label: 'Tân Bình' } // ~8km from Q1

const BASE_ROUTE = {
  id: 'r-test',
  driverId: DRIVER_001_ID,
  departureWindowStartDate: '2030-03-20T07:15:00.000Z',
  departureWindowEndDate: '2030-03-20T07:15:00.000Z',
  origin: Q1_PICKUP,
  destination: TD_DROPOFF,
  status: 'published',
  tripPrice: 100000,
}

const BASE_PLAN = {
  departureWindowStartDate: '2030-03-20T07:00:00.000Z',
  departureWindowEndDate: '2030-03-20T07:30:00.000Z',
  origin: { lat: 10.776, lng: 106.701, label: 'Quận 1' }, // ~130m from Q1
  destination: { lat: 10.854, lng: 106.754, label: 'Thủ Đức' }, // ~60m from TD
  clientId: CLIENT_001_ID,
}

function assertApproxEqual(actual: number, expected: number, epsilon = 0.000001): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  )
}

const NORMALIZED_ROUTE_WITHOUT_GEOMETRY = {
  ...BASE_ROUTE,
  origin: { lat: 0, lng: 0, label: 'Quận 1' },
  destination: { lat: 0, lng: 0, label: 'Thủ Đức' },
  originWardId: 'ward-q1',
  originProvinceId: 'province-hcm',
  destinationWardId: 'ward-td',
  destinationProvinceId: 'province-hcm',
}

const NORMALIZED_PLAN_WITH_GEOMETRY = {
  ...BASE_PLAN,
  originWardId: 'ward-q1',
  originProvinceId: 'province-hcm',
  destinationWardId: 'ward-td',
  destinationProvinceId: 'province-hcm',
}

// ─── 2.1 Geo helpers ──────────────────────────────────────────────────────────

describe('haversineDistance', () => {
  it('returns ~0 for identical points', () => {
    const d = matching.haversineDistance(Q1_PICKUP, Q1_PICKUP)
    assert.ok(d < 0.001, 'Same point should be ~0km')
  })

  it('returns ~13km Q1 → Thủ Đức', () => {
    const d = matching.haversineDistance(Q1_PICKUP, TD_DROPOFF)
    assert.ok(d > 10 && d < 15, `Expected ~13km, got ${d.toFixed(2)}km`)
  })
})

describe('computeBearing', () => {
  it('returns north (~0°) when destination is directly north', () => {
    const north = { lat: Q1_PICKUP.lat + 0.1, lng: Q1_PICKUP.lng }
    const b = matching.computeBearing(Q1_PICKUP, north)
    assert.ok(b < 5 || b > 355, `Expected ~0°, got ${b.toFixed(1)}°`)
  })

  it('returns a valid bearing in [0, 360)', () => {
    const b = matching.computeBearing(Q1_PICKUP, TD_DROPOFF)
    assert.ok(b >= 0 && b < 360)
  })
})

describe('bearingDifference', () => {
  it('returns 0 for identical bearings', () => {
    assert.equal(matching.bearingDifference(45, 45), 0)
  })

  it('returns 10 for bearings 10° apart', () => {
    assert.equal(matching.bearingDifference(350, 360), 10)
  })

  it('wraps correctly across 360°', () => {
    assert.equal(matching.bearingDifference(10, 350), 20)
  })

  it('never exceeds 180', () => {
    const diff = matching.bearingDifference(0, 181)
    assert.ok(diff <= 180)
  })
})

// ─── 2.2 passesHardFilters ────────────────────────────────────────────────────

describe('passesHardFilters', () => {
  it('passes for a well-aligned route/plan pair', async () => {
    assert.ok(await matching.passesHardFilters(BASE_ROUTE, BASE_PLAN, null, []))
  })

  it('correctly maps identical local offsets to overlapping UTC instants', async () => {
    // 14:15 +07:00 is 07:15 UTC
    const route = {
      ...BASE_ROUTE,
      departureWindowStartDate: '2030-03-20T14:15:00.000+07:00',
    }
    const plan = {
      ...BASE_PLAN,
      departureWindowStartDate: '2030-03-20T14:00:00.000+07:00',
      departureWindowEndDate: '2030-03-20T14:30:00.000+07:00',
    }
    assert.ok(await matching.passesHardFilters(route, plan, null, []))
  })

  it('matches when route block expands 30 minutes after during matching', async () => {
    const route = {
      ...BASE_ROUTE,
      departureWindowStartDate: '2030-03-20T07:00:00.000Z',
    }
    const plan = {
      ...BASE_PLAN,
      departureWindowStartDate: '2030-03-20T07:30:00.000Z',
      departureWindowEndDate: '2030-03-20T08:30:00.000Z',
    }

    assert.ok(await matching.passesHardFilters(route, plan, null, []))
  })

  it('matches when route block expands 30 minutes before during matching', async () => {
    const route = {
      ...BASE_ROUTE,
      departureWindowStartDate: '2030-03-20T07:30:00.000Z',
    }
    const plan = {
      ...BASE_PLAN,
      departureWindowStartDate: '2030-03-20T06:30:00.000Z',
      departureWindowEndDate: '2030-03-20T07:30:00.000Z',
    }

    assert.ok(await matching.passesHardFilters(route, plan, null, []))
  })

  it('rejects different departureDate', async () => {
    const plan = {
      ...BASE_PLAN,
      departureWindowStartDate: '2030-03-21T07:00:00.000Z',
      departureWindowEndDate: '2030-03-21T07:30:00.000Z',
    }
    assert.equal(
      await matching.passesHardFilters(BASE_ROUTE, plan, null, []),
      false,
    )
  })

  it('rejects non-overlapping departure block', async () => {
    const plan = {
      ...BASE_PLAN,
      departureWindowStartDate: '2030-03-20T08:00:00.000Z',
      departureWindowEndDate: '2030-03-20T08:30:00.000Z',
    }
    assert.equal(
      await matching.passesHardFilters(BASE_ROUTE, plan, null, []),
      false,
    )
  })

  // Regression: driver 07:00-09:00 (+07) must see client plan 08:00-09:00 (+07)
  it('matches when plan starts exactly at expanded route window end (touching boundary)', async () => {
    // Route departs 07:00 +07 = 00:00Z, 30-min block end = 00:30Z, +30 min expansion = 01:00Z
    // Plan 08:00-09:00 +07 = 01:00Z-02:00Z → planStart === routeEnd → must match
    const route = {
      ...BASE_ROUTE,
      departureWindowStartDate: '2030-03-20T00:00:00.000Z', // 07:00 +07
    }
    const plan = {
      ...BASE_PLAN,
      departureWindowStartDate: '2030-03-20T01:00:00.000Z', // 08:00 +07
      departureWindowEndDate: '2030-03-20T02:00:00.000Z',   // 09:00 +07
    }
    assert.ok(await matching.passesHardFilters(route, plan, null, []))
  })

  it('matches full-trip span: windowEnd covers client plan inside trip duration', async () => {
    // Route 07:00-09:00 +07 (windowStart=00:00Z, windowEnd=02:00Z)
    // Plan 08:00-09:00 +07 (01:00Z-02:00Z) — clearly within trip span
    const route = {
      ...BASE_ROUTE,
      departureWindowStartDate: '2030-03-20T00:00:00.000Z', // 07:00 +07
      departureWindowEndDate: '2030-03-20T02:00:00.000Z',     // 09:00 +07
    }
    const plan = {
      ...BASE_PLAN,
      departureWindowStartDate: '2030-03-20T01:00:00.000Z', // 08:00 +07
      departureWindowEndDate: '2030-03-20T02:00:00.000Z',
    }
    assert.ok(await matching.passesHardFilters(route, plan, null, []))
  })

  it('rejects plan clearly outside full-trip span even with windowEnd set', async () => {
    // Route 07:00-09:00 +07, plan 12:00-13:00 +07 — no overlap
    const route = {
      ...BASE_ROUTE,
      departureWindowStartDate: '2030-03-20T00:00:00.000Z', // 07:00 +07
      departureWindowEndDate: '2030-03-20T02:00:00.000Z',     // 09:00 +07
    }
    const plan = {
      ...BASE_PLAN,
      departureWindowStartDate: '2030-03-20T05:00:00.000Z', // 12:00 +07
      departureWindowEndDate: '2030-03-20T06:00:00.000Z',
    }
    assert.equal(
      await matching.passesHardFilters(route, plan, null, []),
      false,
    )
  })

  it('rejects opposite direction (> 30° bearing difference)', async () => {
    // Heading south-west — opposite of our north-east route
    const plan = {
      ...BASE_PLAN,
      origin: TD_DROPOFF,
      destination: Q1_PICKUP,
    }
    assert.equal(
      await matching.passesHardFilters(BASE_ROUTE, plan, null, []),
      false,
    )
  })

  it('rejects pickup distance > 5km', async () => {
    const plan = { ...BASE_PLAN, origin: TB_PICKUP }
    assert.equal(
      await matching.passesHardFilters(BASE_ROUTE, plan, null, []),
      false,
    )
  })

  it('rejects dropoff distance > 5km', async () => {
    const farDropoff = { lat: 10.95, lng: 106.85, label: 'Biên Hòa' }
    const plan = { ...BASE_PLAN, destination: farDropoff }
    assert.equal(
      await matching.passesHardFilters(BASE_ROUTE, plan, null, []),
      false,
    )
  })

  it('passes normalized exact_3 without usable coordinates', async () => {
    assert.ok(
      await matching.passesHardFilters(
        NORMALIZED_ROUTE_WITHOUT_GEOMETRY,
        NORMALIZED_PLAN_WITH_GEOMETRY,
        null,
        [],
      ),
    )
  })

  itDb('rejects when driver blocks client', async () => {
    await userService.blockUser(DRIVER_001_ID, CLIENT_001_ID)
    const driver = {
      id: DRIVER_001_ID,
      blockedUserIds: [CLIENT_001_ID],
    } as unknown as User
    assert.equal(
      await matching.passesHardFilters(BASE_ROUTE, BASE_PLAN, driver, [
        CLIENT_001_ID,
      ]),
      false,
    )
  })

  itDb('rejects when client blocks driver', async () => {
    await userService.blockUser(CLIENT_001_ID, DRIVER_001_ID)
    const driver = {
      id: DRIVER_001_ID,
      blockedUserIds: [],
    } as unknown as User
    assert.equal(
      await matching.passesHardFilters(BASE_ROUTE, BASE_PLAN, driver, [
        CLIENT_001_ID,
      ]),
      false,
    )
  })
})

// ─── 2.3 computeMatchScore ────────────────────────────────────────────────────

describe('computeMatchScore', () => {
  it('returns matchScore > 75 for a strong match (nearly identical coords)', () => {
    const { matchScore } = matching.computeMatchScore(BASE_ROUTE, BASE_PLAN)
    assert.ok(matchScore > 75, `Expected > 75, got ${matchScore}`)
  })

  it('returns matchScore < 50 for a marginal match (far pickup)', () => {
    const marginalPlan = {
      ...BASE_PLAN,
      origin: { lat: 10.81, lng: 106.68, label: 'Xa' }, // ~4.5km away
    }
    const { matchScore } = matching.computeMatchScore(BASE_ROUTE, marginalPlan)
    assert.ok(matchScore < 75, `Expected < 75, got ${matchScore}`)
  })

  it('all fit metrics stay in the [0..1] range', () => {
    const { originFit, destinationFit, timeFit } = matching.computeMatchScore(
      BASE_ROUTE,
      BASE_PLAN,
    )
    assert.ok(
      originFit >= 0 && originFit <= 1,
      `originFit out of range: ${originFit}`,
    )
    assert.ok(
      destinationFit >= 0 && destinationFit <= 1,
      `destinationFit out of range: ${destinationFit}`,
    )
    assert.ok(timeFit >= 0 && timeFit <= 1, `timeFit out of range: ${timeFit}`)
  })

  it('returns raw distance km inputs before proximity normalization', () => {
    const result = matching.computeMatchScore(BASE_ROUTE, BASE_PLAN)

    assertApproxEqual(
      result.originDistanceKm,
      matching.haversineDistance(BASE_ROUTE.origin, BASE_PLAN.origin),
    )
    assertApproxEqual(
      result.destinationDistanceKm,
      matching.haversineDistance(BASE_ROUTE.destination, BASE_PLAN.destination),
    )
  })

  it('detourEstimate is an integer', () => {
    const { detourEstimate } = matching.computeMatchScore(BASE_ROUTE, BASE_PLAN)
    assert.equal(detourEstimate, Math.round(detourEstimate))
  })

  it('falls back to exact-admin scoring when geometry is omitted', () => {
    const result = matching.computeMatchScore(
      NORMALIZED_ROUTE_WITHOUT_GEOMETRY,
      NORMALIZED_PLAN_WITH_GEOMETRY,
    )

    assert.equal(result.matchScore, 100)
    assert.equal(result.originFit, 1)
    assert.equal(result.destinationFit, 1)
    assert.equal(result.originDistanceKm, 0)
    assert.equal(result.destinationDistanceKm, 0)
    assert.equal(result.timeFit, 1)
    assert.equal(result.detourEstimate, 0)
  })
})

// ─── 2.4 computeMatchedDemandGroups ──────────────────────────────────────────

describe('computeMatchedDemandGroups', () => {
  itDb('returns results enriched with scoring fields', async () => {
    await setupTestDb()
    const results = await matching.computeMatchedDemandGroups('route-001')
    assert.ok(results.length > 0, 'Should return at least one result')
    for (const r of results) {
      assert.ok('matchScore' in r, 'Missing matchScore')
      assert.ok('originFit' in r, 'Missing originFit')
      assert.ok('destinationFit' in r, 'Missing destinationFit')
      assert.ok('originDistanceKm' in r, 'Missing originDistanceKm')
      assert.ok('destinationDistanceKm' in r, 'Missing destinationDistanceKm')
      assert.ok('timeFit' in r, 'Missing timeFit')
      assert.ok('detourEstimate' in r, 'Missing detourEstimate')
    }
  })

  itDb('returns raw distance km fields for matched demand groups', async () => {
    await setupTestDb()
    const departureDay = '2030-05-06'
    const routeOrigin = Q1_PICKUP
    const routeDestination = TD_DROPOFF
    const planOrigin = BASE_PLAN.origin
    const planDestination = BASE_PLAN.destination
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: routeOrigin,
          destination: routeDestination,
          departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
          departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
          tripPrice: 100000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: planOrigin,
      destination: planDestination,
      originWardId: 'ward-raw-distance-group',
      destinationWardId: 'ward-raw-distance-group-dest',
      departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
      departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
      passengerCount: 1,
    })

    const results = await matching.computeMatchedDemandGroups(route.id)
    const result = results.find((group) => group.memberPlanIds?.includes(plan.id))
    assert.ok(result, 'Expected demand group match for created plan')
    assertApproxEqual(
      result.originDistanceKm,
      matching.haversineDistance(routeOrigin, planOrigin),
    )
    assertApproxEqual(
      result.destinationDistanceKm,
      matching.haversineDistance(routeDestination, planDestination),
    )
  })

  itDb('within each tier, higher matchScore appears first', async () => {
    await setupTestDb()
    const results = await matching.computeMatchedDemandGroups('route-001')
    const exactResults = results.filter((r) => r.matchTier === 'exact_3')
    for (let i = 1; i < exactResults.length; i++) {
      assert.ok(
        exactResults[i - 1].matchScore >= exactResults[i].matchScore,
        'exact_3 results not sorted by matchScore desc',
      )
    }
    const nearResults = results.filter((r) => r.matchTier === 'near_3')
    for (let i = 1; i < nearResults.length; i++) {
      assert.ok(
        nearResults[i - 1].matchScore >= nearResults[i].matchScore,
        'near_3 results not sorted by matchScore desc',
      )
    }
  })

  itDb('exact_3 results appear before near_3', async () => {
    await setupTestDb()
    const results = await matching.computeMatchedDemandGroups('route-001')
    let seenNear = false
    for (const r of results) {
      if (r.matchTier === 'near_3') seenNear = true
      if (seenNear) {
        assert.notEqual(r.matchTier, 'exact_3', 'exact_3 appeared after near_3')
      }
    }
  })

  itDb('returns empty array for non-existent route', async () => {
    assert.deepEqual(await matching.computeMatchedDemandGroups('route-999'), [])
  })

  itDb(
    'excludes groups whose plan has a pending inbound search request for the route',
    async () => {
      await setupTestDb()
      const departureDay = '2030-04-30'
      const route = await driverRouteService.publishRoute(
        (
          await driverRouteService.createRoute(DRIVER_001_ID, {
            carId: 'car-001',
            origin: Q1_PICKUP,
            destination: TD_DROPOFF,
            departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
            departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
            tripPrice: 100000,
            distanceMeters: 10000,
          })
        ).id,
      )
      const plan = await planService.createPlan(CLIENT_001_ID, {
        origin: Q1_PICKUP,
        destination: TD_DROPOFF,
        originWardId: 'ward-pending-search',
        destinationWardId: 'ward-pending-search-dest',
        departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
        departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
        passengerCount: 1,
      })

      const beforeRequest = await matching.computeMatchedDemandGroups(route.id)
      assert.equal(
        beforeRequest.some((group) => group.memberPlanIds?.includes(plan.id)),
        true,
      )

      await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)

      const afterRequest = await matching.computeMatchedDemandGroups(route.id)
      assert.equal(
        afterRequest.some((group) => group.memberPlanIds?.includes(plan.id)),
        false,
      )
    },
  )

  itDb(
    'excludes pending inbound route requests even when linked plan is no longer active',
    async () => {
      await setupTestDb()
      const departureDay = '2030-04-29'
      const route = await driverRouteService.publishRoute(
        (
          await driverRouteService.createRoute(DRIVER_001_ID, {
            carId: 'car-001',
            origin: Q1_PICKUP,
            destination: TD_DROPOFF,
            departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
            departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
            tripPrice: 100000,
            distanceMeters: 10000,
          })
        ).id,
      )
      const plan = await planService.createPlan(CLIENT_001_ID, {
        origin: Q1_PICKUP,
        destination: TD_DROPOFF,
        originWardId: 'ward-pending-canceled-plan',
        destinationWardId: 'ward-pending-canceled-plan-dest',
        departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
        departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
        passengerCount: 1,
      })

      await routeRequestService.createRouteRequest(CLIENT_001_ID, plan.id, route.id)
      await planService.cancelPlanByClient(plan.id, CLIENT_001_ID)

      const results = await matching.computeMatchedDemandGroups(route.id)
      assert.equal(
        results.some((group) => group.memberPlanIds?.includes(plan.id)),
        false,
      )
    },
  )

  itDb(
    'keeps groups when pending inbound search request has no linked plan',
    async () => {
      await setupTestDb()
      const departureDay = '2030-05-01'
      const route = await driverRouteService.publishRoute(
        (
          await driverRouteService.createRoute(DRIVER_001_ID, {
            carId: 'car-001',
            origin: Q1_PICKUP,
            destination: TD_DROPOFF,
            departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
            departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
            tripPrice: 100000,
            distanceMeters: 10000,
          })
        ).id,
      )
      const plan = await planService.createPlan(CLIENT_001_ID, {
        origin: Q1_PICKUP,
        destination: TD_DROPOFF,
        originWardId: 'ward-adhoc-search',
        destinationWardId: 'ward-adhoc-search-dest',
        departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
        departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
        passengerCount: 1,
      })

      const otherPlan = await planService.createPlan(CLIENT_001_ID, {
        origin: Q1_PICKUP,
        destination: TD_DROPOFF,
        originWardId: 'ward-adhoc-search-other',
        destinationWardId: 'ward-adhoc-search-other-dest',
        departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
        departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
        passengerCount: 1,
      })
      await routeRequestService.createRouteRequest(CLIENT_001_ID, otherPlan.id, route.id)

      const results = await matching.computeMatchedDemandGroups(route.id)
      assert.equal(
        results.some((group) => group.memberPlanIds?.includes(plan.id)),
        true,
      )
    },
  )

  itDb('returns empty array when route has an accepted group offer', async () => {
    const departureDay = '2030-05-02'
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: Q1_PICKUP,
          destination: TD_DROPOFF,
          departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
          departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
          tripPrice: 100000,
          distanceMeters: 10000,
        })
      ).id,
    )
    await planService.createPlan(CLIENT_001_ID, {
      origin: Q1_PICKUP,
      destination: TD_DROPOFF,
      originWardId: 'ward-accepted-offer',
      destinationWardId: 'ward-accepted-offer-dest',
      departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
      departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const beforeAccept = await matching.computeMatchedDemandGroups(route.id)
    assert.ok(beforeAccept.length > 0)

    const groupRequest = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      route.id,
      beforeAccept[0].demandGroupId,
    )
    await markRouteFeeReserved(route.id)
    await groupOfferService.acceptGroupOffer(groupRequest.offers[0].id)

    assert.deepEqual(await matching.computeMatchedDemandGroups(route.id), [])
  })

  itDb('returns empty array when route has an accepted route request', async () => {
    const departureDay = '2030-05-03'
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: Q1_PICKUP,
          destination: TD_DROPOFF,
          departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
          departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
          tripPrice: 100000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: Q1_PICKUP,
      destination: TD_DROPOFF,
      originWardId: 'ward-accepted-route-request',
      destinationWardId: 'ward-accepted-route-request-dest',
      departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
      departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )
    await markRouteFeeReserved(route.id)
    await routeRequestService.acceptRouteRequest(routeRequest.id)

    assert.deepEqual(await matching.computeMatchedDemandGroups(route.id), [])
  })
})

// ─── 2.5 computeMatchingRoutesFromCriteria ────────────────────────────────────

describe('computeMatchingRoutesFromCriteria', () => {
  itDb('treats criteria as a plan and returns matches', async () => {
    const criteria = {
      ...BASE_PLAN,
      clientId: CLIENT_001_ID,
    }
    const results = await matching.computeMatchingRoutesFromCriteria(criteria)
    assert.ok(Array.isArray(results))
  })

  itDb('returns raw distance km fields for matching routes', async () => {
    await setupTestDb()
    const departureDay = '2030-05-07'
    const routeOrigin = Q1_PICKUP
    const routeDestination = TD_DROPOFF
    const criteriaOrigin = BASE_PLAN.origin
    const criteriaDestination = BASE_PLAN.destination
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: routeOrigin,
          destination: routeDestination,
          departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
          departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
          tripPrice: 100000,
          distanceMeters: 10000,
        })
      ).id,
    )

    const results = await matching.computeMatchingRoutesFromCriteria({
      ...BASE_PLAN,
      origin: criteriaOrigin,
      destination: criteriaDestination,
      departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
      departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
      clientId: CLIENT_001_ID,
    })
    const result = results.find((candidate) => candidate.routeId === route.id)
    assert.ok(result, 'Expected matching route for created criteria')
    assertApproxEqual(
      result.originDistanceKm,
      matching.haversineDistance(routeOrigin, criteriaOrigin),
    )
    assertApproxEqual(
      result.destinationDistanceKm,
      matching.haversineDistance(routeDestination, criteriaDestination),
    )
  })

  itDb('omits route with accepted group offer', async () => {
    const departureDay = '2030-05-04'
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: Q1_PICKUP,
          destination: TD_DROPOFF,
          departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
          departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
          tripPrice: 100000,
          distanceMeters: 10000,
        })
      ).id,
    )
    await planService.createPlan(CLIENT_001_ID, {
      origin: Q1_PICKUP,
      destination: TD_DROPOFF,
      originWardId: 'ward-search-accepted-offer',
      destinationWardId: 'ward-search-accepted-offer-dest',
      departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
      departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const matches = await matching.computeMatchedDemandGroups(route.id)
    const groupRequest = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      route.id,
      matches[0].demandGroupId,
    )
    await markRouteFeeReserved(route.id)
    await groupOfferService.acceptGroupOffer(groupRequest.offers[0].id)

    const results = await matching.computeMatchingRoutesFromCriteria({
      ...BASE_PLAN,
      departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
      departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
      clientId: CLIENT_001_ID,
    })
    assert.equal(results.some((result) => result.routeId === route.id), false)
  })

  itDb('omits route with accepted route request', async () => {
    const departureDay = '2030-05-05'
    const route = await driverRouteService.publishRoute(
      (
        await driverRouteService.createRoute(DRIVER_001_ID, {
          carId: 'car-001',
          origin: Q1_PICKUP,
          destination: TD_DROPOFF,
          departureWindowStartDate: `${departureDay}T07:15:00.000Z`,
          departureWindowEndDate: `${departureDay}T07:15:00.000Z`,
          tripPrice: 100000,
          distanceMeters: 10000,
        })
      ).id,
    )
    const plan = await planService.createPlan(CLIENT_001_ID, {
      origin: Q1_PICKUP,
      destination: TD_DROPOFF,
      originWardId: 'ward-search-accepted-route-request',
      destinationWardId: 'ward-search-accepted-route-request-dest',
      departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
      departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
      passengerCount: 1,
    })
    const routeRequest = await routeRequestService.createRouteRequest(
      CLIENT_001_ID,
      plan.id,
      route.id,
    )
    await markRouteFeeReserved(route.id)
    await routeRequestService.acceptRouteRequest(routeRequest.id)

    const results = await matching.computeMatchingRoutesFromCriteria({
      ...BASE_PLAN,
      departureWindowStartDate: `${departureDay}T07:00:00.000Z`,
      departureWindowEndDate: `${departureDay}T07:30:00.000Z`,
      clientId: CLIENT_001_ID,
    })
    assert.equal(results.some((result) => result.routeId === route.id), false)
  })
})
