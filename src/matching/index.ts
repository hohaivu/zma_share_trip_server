import { computeDepartureBlock } from '../domain/departureBlock'
import * as driverRouteRepository from '../repositories/driverRouteRepository'
import * as userService from '../services/userService'
import { User, Route } from '../types/entities'
import {
  DemandGroupResult,
  MatchingRouteResult,
  PlanLike,
  RouteLike,
  SearchRoutesCriteriaPayload,
} from '../types/payloads'
import {
  haversineDistance,
  computeBearing,
  bearingDifference,
  hasUsablePoint,
  EARTH_RADIUS_KM,
  toRad,
} from './geo'
import {
  MAX_BEARING_DIFF,
  MAX_PICKUP_KM,
  MAX_DROPOFF_KM,
  MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES,
  MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES,
  MS_PER_MINUTE,
} from './thresholds'
import { hasExactAdminMatch, classifyByAdminAndDistance, computeVisibilityMode } from './tier'
import {
  directionScore,
  proximityScore,
  timeOverlapScore,
  estimateDetour,
  computeMatchScore,
  computeMatchScoreWithBearings,
} from './score'
import { FilterContext, CandidateSource, HardFilter } from './ports'
import { MatchEngine } from './engine'
import { allRoutesSource } from './sources/allRoutesSource'
import { demandGroupsSource } from './sources/demandGroupsSource'
import { sameDateFilter } from './filters/sameDateFilter'
import { blockOverlapFilter } from './filters/blockOverlapFilter'
import { tierFilter } from './filters/tierFilter'
import { clientMutualBlockFilter } from './filters/clientMutualBlockFilter'
import { mutualBlockFilter } from './filters/mutualBlockFilter'
import { bearingFilter } from './filters/bearingFilter'
import { proximityFilter } from './filters/proximityFilter'
import { sortByTierThenScore } from './ranker'

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

// ─── Hard filters (public API used by tests) ─────────────────────────────────

export async function passesHardFilters(
  route: RouteLike,
  planLike: PlanLike,
  driver: User | null,
  clientIds: string[],
): Promise<boolean> {
  const routeBearing = computeBearing(route.origin, route.destination)
  const planBearing = computeBearing(planLike.origin, planLike.destination)

  if (route.departureDate.slice(0, 10) !== planLike.departureDate.slice(0, 10)) return false

  const ctx: FilterContext = {
    driver,
    userCache: new Map(),
    blockedUserCache: new Map(),
    routeAvailableCache: new Map(),
    dateBlockCache: new Map(),
    routeBearing,
    planBearing,
  }

  const blockKey = `${route.departureDate}|${route.windowEnd}|${planLike.windowStart}|${planLike.windowEnd}`
  if (!ctx.dateBlockCache.has(blockKey)) {
    const routeBlock = computeDepartureBlock(route.departureDate)
    const routeSpanEndMs = route.windowEnd
      ? new Date(route.windowEnd).getTime()
      : new Date(routeBlock.end).getTime()
    const routeStartMs = new Date(routeBlock.start).getTime() - MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES * MS_PER_MINUTE
    const routeEndMs = routeSpanEndMs + MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES * MS_PER_MINUTE
    const planStartMs = new Date(planLike.windowStart).getTime()
    const planEndMs = new Date(planLike.windowEnd).getTime()
    ctx.dateBlockCache.set(blockKey, routeStartMs <= planEndMs && planStartMs <= routeEndMs)
  }
  if (!ctx.dateBlockCache.get(blockKey)) return false

  if (driver) {
    const ids = Array.isArray(clientIds) ? clientIds : []
    let driverBlockedIds = ctx.blockedUserCache.get(driver.id)
    if (!driverBlockedIds) {
      driverBlockedIds = await userService.getBlockedUsers(driver.id)
      ctx.blockedUserCache.set(driver.id, driverBlockedIds)
    }
    for (const clientId of ids) {
      let client = ctx.userCache.get(clientId)
      if (client === undefined) {
        client = await userService.getUser(clientId)
        ctx.userCache.set(clientId, client)
      }
      if (!client) continue
      let clientBlockedIds = ctx.blockedUserCache.get(clientId)
      if (!clientBlockedIds) {
        clientBlockedIds = await userService.getBlockedUsers(clientId)
        ctx.blockedUserCache.set(clientId, clientBlockedIds)
      }
      if (driverBlockedIds.includes(clientId) || clientBlockedIds.includes(driver.id)) return false
    }
  }

  if (hasExactAdminMatch(route, planLike)) return true

  if (bearingDifference(routeBearing, planBearing) > MAX_BEARING_DIFF) return false
  if (haversineDistance(route.origin, planLike.origin) > MAX_PICKUP_KM) return false
  if (haversineDistance(route.destination, planLike.destination) > MAX_DROPOFF_KM) return false

  return true
}

// ─── Client pipeline ──────────────────────────────────────────────────────────

const clientEngine = new MatchEngine<SearchRoutesCriteriaPayload, Route, MatchingRouteResult>({
  source: allRoutesSource as unknown as CandidateSource<SearchRoutesCriteriaPayload, Route>,
  filters: [
    sameDateFilter,
    blockOverlapFilter,
    tierFilter,
    clientMutualBlockFilter,
    bearingFilter,
    proximityFilter,
  ] as unknown as HardFilter<SearchRoutesCriteriaPayload, Route>[],
  score: (route, criteria, ctx) => {
    const routeBearing = ctx.routeBearing ?? computeBearing(route.origin, route.destination)
    const planBearing = ctx.planBearing ?? computeBearing(criteria.origin, criteria.destination)
    const scores = computeMatchScoreWithBearings(route, criteria, routeBearing, planBearing)
    const driver = ctx.userCache.get(route.driverId)
    return {
      routeId: route.id,
      matchTier: ctx.matchTier!,
      tripPrice: route.tripPrice,
      departureDate: route.departureDate,
      windowStart: route.windowStart,
      windowEnd: route.windowEnd,
      origin: route.origin,
      destination: route.destination,
      driverSummary: driver
        ? {
            id: driver.id,
            mauid: driver.mauid,
            displayName: driver.displayName,
            avatarUrl: driver.avatarUrl,
            verificationStatus: driver.verificationStatus,
            ratingAvg: driver.ratingAvg,
            tripCount: driver.tripCount,
          }
        : null,
      carId: route.carId,
      routeAvailable: true,
      ...scores,
    }
  },
  rank: sortByTierThenScore,
  buildContext: () => ({
    driver: null,
    userCache: new Map(),
    blockedUserCache: new Map(),
    routeAvailableCache: new Map(),
    dateBlockCache: new Map(),
  }),
})

export async function computeMatchingRoutesFromCriteria(
  criteria: SearchRoutesCriteriaPayload,
): Promise<MatchingRouteResult[]> {
  await userService.assertUserRole(criteria.clientId, 'client')
  return clientEngine.run(criteria)
}

// ─── Driver pipeline (FilterContext + inline loop) ───────────────────────────

export async function computeMatchedDemandGroups(
  routeId: string,
): Promise<DemandGroupResult[]> {
  const route = await driverRouteRepository.getRoute(routeId)
  if (!route) return []
  if (route.status !== 'published') return []
  if (!(await driverRouteRepository.isRouteAvailable(routeId))) return []

  const driver = await userService.getUser(route.driverId)
  const ctx: FilterContext = {
    driver,
    userCache: new Map([[route.driverId, driver]]),
    blockedUserCache: new Map(),
    routeAvailableCache: new Map([[routeId, true]]),
    dateBlockCache: new Map(),
    routeBearing: computeBearing(route.origin, route.destination),
  }

  const groups = await demandGroupsSource.list({ routeId }, ctx)
  const results: DemandGroupResult[] = []

  for (const group of groups) {
    ctx.matchTier = undefined
    ctx.adminExact = undefined
    ctx.planBearing = undefined

    const planBearing = computeBearing(group.origin, group.destination)
    ctx.planBearing = planBearing

    // sameDateFilter (route is the "query" in driver path, group is candidate)
    if (route.departureDate.slice(0, 10) !== group.departureDate.slice(0, 10)) continue

    // blockOverlapFilter — route side gets expanded, group provides plan window
    const blockKey = `${route.departureDate}|${route.windowEnd}|${group.windowStart}|${group.windowEnd}`
    let overlaps = ctx.dateBlockCache.get(blockKey)
    if (overlaps === undefined) {
      const routeBlock = computeDepartureBlock(route.departureDate)
      const routeSpanEndMs = route.windowEnd
        ? new Date(route.windowEnd).getTime()
        : new Date(routeBlock.end).getTime()
      const routeStartMs = new Date(routeBlock.start).getTime() - MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES * MS_PER_MINUTE
      const routeEndMs = routeSpanEndMs + MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES * MS_PER_MINUTE
      const planStartMs = new Date(group.windowStart).getTime()
      const planEndMs = new Date(group.windowEnd).getTime()
      overlaps = routeStartMs <= planEndMs && planStartMs <= routeEndMs
      ctx.dateBlockCache.set(blockKey, overlaps)
    }
    if (!overlaps) continue

    // tierFilter (route as "route" side, group as "plan" side)
    const matchTier = classifyByAdminAndDistance(route, group)
    if (!matchTier) continue
    ctx.matchTier = matchTier
    ctx.adminExact = hasExactAdminMatch(route, group)

    // mutualBlockFilter — ctx.driver is fixed, group provides clientIds
    if (!(await mutualBlockFilter.passes(group, {} as never, ctx))) continue

    // bearingFilter + proximityFilter (skipped when adminExact)
    if (!ctx.adminExact) {
      if (bearingDifference(ctx.routeBearing!, planBearing) > MAX_BEARING_DIFF) continue
      if (haversineDistance(route.origin, group.origin) > MAX_PICKUP_KM) continue
      if (haversineDistance(route.destination, group.destination) > MAX_DROPOFF_KM) continue
    }

    const visibilityMode = computeVisibilityMode(matchTier, group.memberCount)
    const scores = computeMatchScoreWithBearings(route, group, ctx.routeBearing!, planBearing)

    results.push({
      demandGroupId: group.id,
      matchTier,
      visibilityMode,
      tripPrice: route.tripPrice,
      departureDate: group.departureDate,
      originWardId: group.originWardId,
      destinationWardId: group.destinationWardId,
      originWardName: group.origin?.label || group.originWardId,
      destinationWardName: group.destination?.label || group.destinationWardId,
      originProvinceId: group.originProvinceId,
      destinationProvinceId: group.destinationProvinceId,
      windowStart: group.windowStart,
      windowEnd: group.windowEnd,
      memberCount: group.memberCount,
      totalPassengerCount: group.totalPassengerCount,
      memberPlanIds: group.memberPlanIds,
      ...scores,
    })
  }

  return sortByTierThenScore(results)
}
