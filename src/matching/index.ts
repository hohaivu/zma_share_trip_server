import { computeDepartureBlock } from '../domain/departureBlock'
import * as driverRouteRepository from '../repositories/driverRouteRepository'
import * as userService from '../services/userService'
import { User, Route } from '../types/entities'
import {
  DemandGroupResult,
  DemandGroupSummary,
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

// ─── Driver pipeline ──────────────────────────────────────────────────────────

interface DriverMatchQuery extends Route {
  routeId: string
  driver: User | null
}

const driverEngine = new MatchEngine<DriverMatchQuery, DemandGroupSummary, DemandGroupResult>({
  source: demandGroupsSource as unknown as CandidateSource<DriverMatchQuery, DemandGroupSummary>,
  filters: [
    {
      name: 'sameDateFilter',
      async passes(group, q, _ctx): Promise<boolean> {
        return group.departureDate.slice(0, 10) === q.departureDate.slice(0, 10)
      },
    },
    {
      name: 'blockOverlapFilter',
      async passes(group, q, ctx): Promise<boolean> {
        const key = `${q.departureDate}|${q.windowEnd}|${group.windowStart}|${group.windowEnd}`
        if (ctx.dateBlockCache.has(key)) return ctx.dateBlockCache.get(key)!
        const routeBlock = computeDepartureBlock(q.departureDate)
        const routeSpanEndMs = q.windowEnd
          ? new Date(q.windowEnd).getTime()
          : new Date(routeBlock.end).getTime()
        const routeStartMs =
          new Date(routeBlock.start).getTime() -
          MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES * MS_PER_MINUTE
        const routeEndMs = routeSpanEndMs + MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES * MS_PER_MINUTE
        const planStartMs = new Date(group.windowStart).getTime()
        const planEndMs = new Date(group.windowEnd).getTime()
        const result = routeStartMs <= planEndMs && planStartMs <= routeEndMs
        ctx.dateBlockCache.set(key, result)
        return result
      },
    },
    {
      name: 'tierFilter',
      async passes(group, q, ctx): Promise<boolean> {
        const tier = classifyByAdminAndDistance(q, group)
        if (!tier) return false
        ctx.matchTier = tier
        ctx.adminExact = hasExactAdminMatch(q, group)
        return true
      },
    },
    mutualBlockFilter as unknown as HardFilter<DriverMatchQuery, DemandGroupSummary>,
    {
      name: 'bearingFilter',
      async passes(group, _q, ctx): Promise<boolean> {
        const planBearing = computeBearing(group.origin, group.destination)
        ctx.planBearing = planBearing
        if (ctx.adminExact) return true
        return bearingDifference(ctx.routeBearing!, planBearing) <= MAX_BEARING_DIFF
      },
    },
    {
      name: 'proximityFilter',
      async passes(group, q, ctx): Promise<boolean> {
        if (ctx.adminExact) return true
        if (haversineDistance(q.origin, group.origin) > MAX_PICKUP_KM) return false
        if (haversineDistance(q.destination, group.destination) > MAX_DROPOFF_KM) return false
        return true
      },
    },
  ] as HardFilter<DriverMatchQuery, DemandGroupSummary>[],
  score: (group, q, ctx) => {
    const visibilityMode = computeVisibilityMode(ctx.matchTier!, group.memberCount)
    const scores = computeMatchScoreWithBearings(q, group, ctx.routeBearing!, ctx.planBearing!)
    return {
      demandGroupId: group.id,
      matchTier: ctx.matchTier!,
      visibilityMode,
      tripPrice: q.tripPrice,
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
    }
  },
  rank: sortByTierThenScore,
  buildContext: (q) => ({
    driver: q.driver,
    userCache: new Map([[q.driverId, q.driver]]),
    blockedUserCache: new Map(),
    routeAvailableCache: new Map([[q.routeId, true]]),
    dateBlockCache: new Map(),
    routeBearing: computeBearing(q.origin, q.destination),
  }),
})

export async function computeMatchedDemandGroups(routeId: string): Promise<DemandGroupResult[]> {
  const route = await driverRouteRepository.getRoute(routeId)
  if (!route) return []
  if (route.status !== 'published') return []
  if (!(await driverRouteRepository.isRouteAvailable(routeId))) return []
  const driver = await userService.getUser(route.driverId)
  return driverEngine.run({ ...route, routeId, driver })
}
