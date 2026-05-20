import * as driverRouteRepository from '../repositories/driverRouteRepository'
import * as userService from '../services/userService'
import { Route, User } from '../types/entities'
import {
  DemandGroupResult,
  MatchingRouteResult,
  PlanLike,
  RouteLike,
  SearchRoutesCriteriaPayload,
} from '../types/payloads'
import { getCachedBlockedUsers, getCachedUser } from './cache'
import { MatchEngine } from './engine'
import { bearingFilter } from './filters/bearingFilter'
import {
  clientBlockOverlapFilter,
  routePlanWindowsOverlap,
} from './filters/blockOverlapFilter'
import { clientMutualBlockFilter } from './filters/clientMutualBlockFilter'
import { mutualBlockFilter } from './filters/mutualBlockFilter'
import { proximityFilter } from './filters/proximityFilter'
import { sameDateFilter } from './filters/sameDateFilter'
import { tierFilter } from './filters/tierFilter'
import {
  bearingDifference,
  computeBearing,
  EARTH_RADIUS_KM,
  hasUsablePoint,
  haversineDistance,
  toRad,
} from './geo'
import { FilterContext } from './ports'
import { sortByTierThenScore } from './ranker'
import {
  computeMatchScore,
  computeMatchScoreWithBearings,
  directionScore,
  estimateDetour,
  proximityScore,
  timeOverlapScore,
} from './score'
import { allRoutesSource } from './sources/allRoutesSource'
import { demandGroupsSource, DemandGroupCandidate } from './sources/demandGroupsSource'
import {
  MAX_BEARING_DIFF,
  MAX_DROPOFF_KM,
  MAX_PICKUP_KM,
} from './thresholds'
import {
  computeVisibilityMode,
  hasExactAdminMatch,
} from './tier'

export {
  EARTH_RADIUS_KM,
  toRad,
  haversineDistance,
  computeBearing,
  bearingDifference,
  hasUsablePoint,
  MAX_BEARING_DIFF,
  MAX_PICKUP_KM,
  MAX_DROPOFF_KM,
  directionScore,
  proximityScore,
  timeOverlapScore,
  estimateDetour,
  computeMatchScore,
  computeVisibilityMode,
}

function emptyContext(driver: User | null = null): FilterContext {
  return {
    driver,
    userCache: new Map(),
    blockedUserCache: new Map(),
    routeAvailableCache: new Map(),
    dateBlockCache: new Map(),
  }
}

// ─── Hard filters (public API used by tests) ─────────────────────────────────

export async function passesHardFilters(
  route: RouteLike,
  planLike: PlanLike,
  driver: User | null,
  clientIds: string[],
): Promise<boolean> {
  if (route.departureWindowStartDate.slice(0, 10) !== planLike.departureWindowStartDate.slice(0, 10)) return false

  if (!routePlanWindowsOverlap(
    route.departureWindowStartDate,
    route.departureWindowEndDate,
    planLike.departureWindowStartDate,
    planLike.departureWindowEndDate,
  )) {
    return false
  }

  if (driver) {
    const ctx = emptyContext(driver)
    const driverBlockedIds = await getCachedBlockedUsers(ctx, driver.id)
    for (const clientId of clientIds) {
      const client = await getCachedUser(ctx, clientId)
      if (!client) continue
      const clientBlockedIds = await getCachedBlockedUsers(ctx, clientId)
      if (driverBlockedIds.includes(clientId) || clientBlockedIds.includes(driver.id)) return false
    }
  }

  if (hasExactAdminMatch(route, planLike)) return true

  const routeBearing = computeBearing(route.origin, route.destination)
  const planBearing = computeBearing(planLike.origin, planLike.destination)
  if (bearingDifference(routeBearing, planBearing) > MAX_BEARING_DIFF) return false
  if (haversineDistance(route.origin, planLike.origin) > MAX_PICKUP_KM) return false
  if (haversineDistance(route.destination, planLike.destination) > MAX_DROPOFF_KM) return false

  return true
}

// ─── Client pipeline ──────────────────────────────────────────────────────────

function buildDriverSummary(driver: User | null) {
  if (!driver) return null
  return {
    id: driver.id,
    mauid: driver.mauid,
    displayName: driver.displayName,
    avatarUrl: driver.avatarUrl,
    verificationStatus: driver.verificationStatus,
    ratingAvg: driver.ratingAvg,
    tripCount: driver.tripCount,
  }
}

const clientEngine = new MatchEngine<SearchRoutesCriteriaPayload, Route, MatchingRouteResult>({
  source: allRoutesSource,
  filters: [
    sameDateFilter,
    clientBlockOverlapFilter,
    tierFilter,
    clientMutualBlockFilter,
    bearingFilter,
    proximityFilter,
  ],
  score: (route, criteria, ctx) => {
    const routeBearing = computeBearing(route.origin, route.destination)
    const planBearing = computeBearing(criteria.origin, criteria.destination)
    const scores = computeMatchScoreWithBearings(route, criteria, routeBearing, planBearing)
    return {
      routeId: route.id,
      matchTier: ctx.matchTier!,
      tripPrice: route.tripPrice,
      departureWindowStartDate: route.departureWindowStartDate,
      departureWindowEndDate: route.departureWindowEndDate,
      origin: route.origin,
      destination: route.destination,
      driverSummary: buildDriverSummary(ctx.userCache.get(route.driverId) ?? null),
      carId: route.carId,
      routeAvailable: true,
      ...scores,
    }
  },
  rank: sortByTierThenScore,
  buildContext: () => emptyContext(),
})

export async function computeMatchingRoutesFromCriteria(
  criteria: SearchRoutesCriteriaPayload,
): Promise<MatchingRouteResult[]> {
  await userService.assertUserRole(criteria.clientId, 'client')
  return clientEngine.run(criteria)
}

// ─── Driver pipeline ──────────────────────────────────────────────────────────

interface DriverMatchQuery extends Route {
  routeId: string
  driver: User | null
}

const driverEngine = new MatchEngine<DriverMatchQuery, DemandGroupCandidate, DemandGroupResult>({
  source: demandGroupsSource,
  filters: [
    tierFilter,
    mutualBlockFilter,
    bearingFilter,
    proximityFilter,
  ],
  score: (group, q, ctx) => {
    const routeBearing = computeBearing(q.origin, q.destination)
    const planBearing = computeBearing(group.origin, group.destination)
    const scores = computeMatchScoreWithBearings(q, group, routeBearing, planBearing)
    return {
      demandGroupId: group.id,
      matchTier: ctx.matchTier!,
      visibilityMode: computeVisibilityMode(ctx.matchTier!, group.memberCount),
      tripPrice: q.tripPrice,
      originWardId: group.originWardId,
      destinationWardId: group.destinationWardId,
      originWardName: group.origin?.label || group.originWardId,
      destinationWardName: group.destination?.label || group.destinationWardId,
      originProvinceId: group.originProvinceId,
      destinationProvinceId: group.destinationProvinceId,
      memberCount: group.memberCount,
      totalPassengerCount: group.totalPassengerCount,
      memberPlanIds: group.memberPlanIds,
      clientIds: group.clientIds,
      ...scores,
    }
  },
  rank: sortByTierThenScore,
  buildContext: (q) => ({
    driver: q.driver,
    userCache: new Map([[q.driverId, q.driver]]),
    blockedUserCache: new Map(),
    routeAvailableCache: new Map([[q.routeId, true]]),
    dateBlockCache: new Map(),
  }),
})

export async function computeMatchedDemandGroups(routeId: string): Promise<DemandGroupResult[]> {
  const route = await driverRouteRepository.getRoute(routeId)
  if (!route || route.status !== 'published') return []
  if (!(await driverRouteRepository.isRouteAvailable(routeId))) return []
  const driver = await userService.getUser(route.driverId)
  return driverEngine.run({ ...route, routeId, driver })
}
