import * as store from './store'
import { Location, Route, User } from './types/entities'
import {
  DemandGroupResult,
  DemandGroupSummary,
  MatchingRouteResult,
  PlanLike,
  RouteLike,
  ScoreFields,
  SearchRoutesCriteriaPayload,
} from './types/payloads'

// ─── Geo helpers ───────────────────────────────────────────────────────────────

export const EARTH_RADIUS_KM = 6371

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function haversineDistance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/**
 * Calculate the initial bearing (compass direction) from point a to point b.
 * @returns Bearing in degrees (0–360).
 */
export function computeBearing(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const bearing = (Math.atan2(y, x) * 180) / Math.PI
  return (bearing + 360) % 360
}

/**
 * Calculate the absolute angular difference between two bearings.
 * @returns Difference in degrees (0–180).
 */
export function bearingDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

// ─── Thresholds ────────────────────────────────────────────────────────────────

export const MAX_BEARING_DIFF = 30 // degrees
export const MAX_PICKUP_KM = 5
export const MAX_DROPOFF_KM = 5

// Near-3 canonical ward-distance threshold from spec
const NEAR_3_MAX_WARD_DISTANCE_KM = 20

// ─── Scoring weights ──────────────────────────────────────────────────────────

const W_DIRECTION = 0.3
const W_PICKUP = 0.25
const W_DROPOFF = 0.25
const W_TIME = 0.2

export function hasUsablePoint(
  point: Pick<Location, 'lat' | 'lng'> | null | undefined,
): boolean {
  if (!point) return false

  const lat = Number(point.lat)
  const lng = Number(point.lng)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false

  // 0/0 is the placeholder used when geometry is intentionally omitted.
  return !(lat === 0 && lng === 0)
}

function hasUsableGeometry(routeLike: RouteLike, planLike: PlanLike): boolean {
  return (
    hasUsablePoint(routeLike?.origin) &&
    hasUsablePoint(routeLike?.destination) &&
    hasUsablePoint(planLike?.pickup) &&
    hasUsablePoint(planLike?.dropoff)
  )
}

function hasExactAdminMatch(route: RouteLike, planLike: PlanLike): boolean {
  return (
    !!route?.originWardKey &&
    !!planLike?.pickupWardKey &&
    route.originWardKey === planLike.pickupWardKey &&
    !!route?.destinationWardKey &&
    !!planLike?.dropoffWardKey &&
    route.destinationWardKey === planLike.dropoffWardKey
  )
}

// ─── Component score functions ────────────────────────────────────────────────

export function directionScore(
  routeBearing: number,
  planBearing: number,
): number {
  const diff = bearingDifference(routeBearing, planBearing)
  // Linear: 0° diff → 1.0, 30° diff → 0.0
  return Math.max(0, 1 - diff / MAX_BEARING_DIFF)
}

export function proximityScore(distKm: number, maxKm: number): number {
  return Math.max(0, 1 - distKm / maxKm)
}

/**
 * Time overlap score: 1.0 when departure is at block center, 0.0 at edges.
 * route has a single departureTime; group/plan exposes departureBlockStart/End.
 */
export function timeOverlapScore(
  departureTime: string,
  blockStart: string,
  blockEnd: string,
): number {
  const rTime = new Date(departureTime).getTime()
  const dStart = new Date(blockStart).getTime()
  const dEnd = new Date(blockEnd).getTime()
  const blockDuration = dEnd - dStart
  if (blockDuration <= 0) return rTime === dStart ? 1 : 0
  const distToCenter = Math.abs(rTime - (dStart + blockDuration / 2))
  return Math.max(0, 1 - distToCenter / (blockDuration / 2))
}

/**
 * Estimate detour in minutes at 30km/h city speed.
 */
export function estimateDetour(
  pickupDist: number,
  dropoffDist: number,
): number {
  return Math.round(((pickupDist + dropoffDist) / 30) * 60)
}

// ─── Block Overlap ────────────────────────────────────────────────────────────

/**
 * Check whether a route's departure block overlaps with a plan's departure block.
 */
function blocksOverlap(
  routeDepartureTime: string,
  blockStart: string,
  blockEnd: string,
): boolean {
  const routeBlock = store.computeDepartureBlock(routeDepartureTime)
  const routeStartMs = new Date(routeBlock.start).getTime()
  const routeEndMs = new Date(routeBlock.end).getTime()
  const planStartMs = new Date(blockStart).getTime()
  const planEndMs = new Date(blockEnd).getTime()
  return routeStartMs < planEndMs && planStartMs < routeEndMs
}

// ─── Hard Filters ─────────────────────────────────────────────────────────────

/**
 * Core hard-filter logic with pre-computed bearings.
 */
async function passesHardFiltersWithBearings(
  route: RouteLike,
  planLike: PlanLike,
  driver: User | null,
  clientIds: string[],
  routeBearing: number,
  planBearing: number,
): Promise<boolean> {
  if (route.serviceDate !== planLike.serviceDate) return false

  if (
    !blocksOverlap(
      route.departureTime,
      planLike.departureBlockStart,
      planLike.departureBlockEnd,
    )
  )
    return false

  if (driver) {
    const ids = Array.isArray(clientIds) ? clientIds : []
    for (const clientId of ids) {
      const client = await store.getUser(clientId)
      if (
        client &&
        (driver.blockedUserIds?.includes(clientId) ||
          client.blockedUserIds?.includes(driver.id))
      ) {
        return false
      }
    }
  }

  if (hasExactAdminMatch(route, planLike)) return true

  if (!hasUsableGeometry(route, planLike)) return false

  if (bearingDifference(routeBearing, planBearing) > MAX_BEARING_DIFF)
    return false

  if (haversineDistance(route.origin, planLike.pickup) > MAX_PICKUP_KM)
    return false

  if (haversineDistance(route.destination, planLike.dropoff) > MAX_DROPOFF_KM)
    return false

  return true
}

/**
 * Reject candidates that fail any hard constraint.
 */
export async function passesHardFilters(
  route: RouteLike,
  planLike: PlanLike,
  driver: User | null,
  clientIds: string[],
): Promise<boolean> {
  const routeBearing = computeBearing(route.origin, route.destination)
  const planBearing = computeBearing(planLike.pickup, planLike.dropoff)
  return passesHardFiltersWithBearings(
    route,
    planLike,
    driver,
    clientIds,
    routeBearing,
    planBearing,
  )
}

// ─── Score computation ────────────────────────────────────────────────────────

/**
 * Core match-score logic with pre-computed bearings.
 */
function computeMatchScoreWithBearings(
  route: RouteLike,
  planLike: PlanLike,
  routeBearing: number,
  planBearing: number,
): ScoreFields {
  const time = timeOverlapScore(
    route.departureTime,
    planLike.departureBlockStart,
    planLike.departureBlockEnd,
  )

  if (!hasUsableGeometry(route, planLike)) {
    const fallbackFit = hasExactAdminMatch(route, planLike) ? 1 : 0
    const matchScore = Math.round(
      (fallbackFit * W_DIRECTION +
        fallbackFit * W_PICKUP +
        fallbackFit * W_DROPOFF +
        time * W_TIME) *
        100,
    )

    return {
      matchScore,
      pickupFit: fallbackFit,
      dropoffFit: fallbackFit,
      timeFit: time,
      detourEstimate: 0,
    }
  }

  const pickupDist = haversineDistance(route.origin, planLike.pickup)
  const dropoffDist = haversineDistance(route.destination, planLike.dropoff)

  const dir = directionScore(routeBearing, planBearing)
  const pickup = proximityScore(pickupDist, MAX_PICKUP_KM)
  const dropoff = proximityScore(dropoffDist, MAX_DROPOFF_KM)
  const detour = estimateDetour(pickupDist, dropoffDist)

  const matchScore = Math.round(
    (dir * W_DIRECTION +
      pickup * W_PICKUP +
      dropoff * W_DROPOFF +
      time * W_TIME) *
      100,
  )

  return {
    matchScore,
    pickupFit: pickup,
    dropoffFit: dropoff,
    timeFit: time,
    detourEstimate: detour,
  }
}

/**
 * Compute scoring fields for a route vs planLike pair.
 */
export function computeMatchScore(
  route: RouteLike,
  planLike: PlanLike,
): ScoreFields {
  const routeBearing = computeBearing(route.origin, route.destination)
  const planBearing = computeBearing(planLike.pickup, planLike.dropoff)
  return computeMatchScoreWithBearings(
    route,
    planLike,
    routeBearing,
    planBearing,
  )
}

// ─── Tier classification ──────────────────────────────────────────────────────

/**
 * Classify match tier using administrative identity as primary,
 * with distance metrics as legacy fallback or near_3 classification.
 */
function classifyByAdminAndDistance(
  route: RouteLike,
  planLike: PlanLike,
): 'exact_3' | 'near_3' | null {
  if (hasExactAdminMatch(route, planLike)) return 'exact_3'

  if (!hasUsableGeometry(route, planLike)) return null

  const pickupDist = haversineDistance(route.origin, planLike.pickup)
  const dropoffDist = haversineDistance(route.destination, planLike.dropoff)

  const hasDistanceExact = pickupDist < 1.0 && dropoffDist < 1.0

  if (hasDistanceExact) return 'exact_3'

  if (
    pickupDist < NEAR_3_MAX_WARD_DISTANCE_KM &&
    dropoffDist < NEAR_3_MAX_WARD_DISTANCE_KM
  ) {
    return 'near_3'
  }
  return null
}

/**
 * Classify a demand group against a route as exact_3 or near_3.
 */
function classifyMatch(
  route: RouteLike,
  group: DemandGroupSummary,
): 'exact_3' | 'near_3' | null {
  if (route.serviceDate !== group.serviceDate) return null
  if (
    !blocksOverlap(
      route.departureTime,
      group.departureBlockStart,
      group.departureBlockEnd,
    )
  )
    return null

  return classifyByAdminAndDistance(route, group)
}

/**
 * Compute visibility mode based on match tier and member count.
 */
export function computeVisibilityMode(
  matchTier: string,
  memberCount: number,
): 'single_client_card' | 'group_with_client_list' | 'group_summary_only' {
  if (matchTier === 'exact_3' && memberCount === 1) return 'single_client_card'
  if (matchTier === 'exact_3' && memberCount > 1)
    return 'group_with_client_list'
  return 'group_summary_only'
}

/**
 * Sort match results: exact_3 first, near_3 second; within tier sort by matchScore desc.
 */
function sortByTierThenScore<
  T extends { matchTier: string; matchScore: number },
>(a: T, b: T): number {
  if (a.matchTier === 'exact_3' && b.matchTier !== 'exact_3') return -1
  if (a.matchTier !== 'exact_3' && b.matchTier === 'exact_3') return 1
  return b.matchScore - a.matchScore
}

// ─── Main matching functions ──────────────────────────────────────────────────

/**
 * For a given route, compute all matched demand groups with tier/visibility/score.
 */
export async function computeMatchedDemandGroups(
  routeId: string,
): Promise<DemandGroupResult[]> {
  const route = await store.getRoute(routeId)
  if (!route) return []

  const driver = await store.getUser(route.driverId)
  const groups = await store.deriveDemandGroups()
  const pendingInboundPlanIds = new Set(
    (await store.listRouteRequestsByRoute(routeId))
      .filter((request) => request.status === 'pending') // only pending; accepted/declined do not suppress matches
      .map((request) => request.planId)
      .filter((planId): planId is string => Boolean(planId)),
  )
  const results: DemandGroupResult[] = []

  const routeBearing = computeBearing(route.origin, route.destination)

  for (const group of groups) {
    if (
      group.memberPlanIds.some((planId) => pendingInboundPlanIds.has(planId))
    ) {
      continue
    }

    const matchTier = classifyMatch(route, group)
    if (!matchTier) continue

    const planBearing = computeBearing(group.pickup, group.dropoff)

    const passed = await passesHardFiltersWithBearings(
      route,
      group,
      driver,
      group.clientIds,
      routeBearing,
      planBearing,
    )
    if (!passed) continue

    const visibilityMode = computeVisibilityMode(matchTier, group.memberCount)
    const scores = computeMatchScoreWithBearings(
      route,
      group,
      routeBearing,
      planBearing,
    )

    results.push({
      demandGroupId: group.id,
      matchTier,
      visibilityMode,
      tripPrice: route.tripPrice,
      serviceDate: group.serviceDate,
      pickupWardId: group.pickupWardId,
      dropoffWardId: group.dropoffWardId,
      pickupWardName: group.pickup?.label || group.pickupWardId,
      dropoffWardName: group.dropoff?.label || group.dropoffWardId,
      pickupWardKey: group.pickupWardKey,
      dropoffWardKey: group.dropoffWardKey,
      pickupProvinceId: group.pickupProvinceId,
      dropoffProvinceId: group.dropoffProvinceId,
      departureBlockStart: group.departureBlockStart,
      departureBlockEnd: group.departureBlockEnd,
      memberCount: group.memberCount,
      totalPassengerCount: group.totalPassengerCount,
      memberPlanIds: group.memberPlanIds,
      ...scores,
    })
  }

  results.sort(sortByTierThenScore)

  return results
}

/**
 * For a set of search criteria, find eligible routes with scores.
 */
export async function computeMatchingRoutesFromCriteria(
  criteria: SearchRoutesCriteriaPayload,
): Promise<MatchingRouteResult[]> {
  const allRoutes = await store.listAllRoutes()
  const results: MatchingRouteResult[] = []

  const planBearing = computeBearing(criteria.pickup, criteria.dropoff)

  for (const route of allRoutes) {
    if (route.status !== 'published') continue

    const driver = await store.getUser(route.driverId)
    const routeBearing = computeBearing(route.origin, route.destination)

    const passed = await passesHardFiltersWithBearings(
      route,
      criteria,
      driver,
      [criteria.clientId],
      routeBearing,
      planBearing,
    )
    if (!passed) continue

    const matchTier = classifyByAdminAndDistance(route, criteria)
    if (!matchTier) continue

    const scores = computeMatchScoreWithBearings(
      route,
      criteria,
      routeBearing,
      planBearing,
    )
    const routeAvailable = await store.isRouteAvailable(route.id)

    results.push({
      routeId: route.id,
      matchTier,
      tripPrice: route.tripPrice,
      serviceDate: route.serviceDate,
      departureTime: route.departureTime,
      origin: route.origin,
      destination: route.destination,
      driverSummary: driver
        ? {
            id: driver.id,
            displayName: driver.displayName,
            avatarUrl: driver.avatarUrl,
            ratingAvg: driver.ratingAvg,
            tripCount: driver.tripCount,
          }
        : null,
      carId: route.carId,
      routeAvailable,
      ...scores,
    })
  }

  results.sort(sortByTierThenScore)

  return results
}
