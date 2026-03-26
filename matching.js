const store = require('./store')

// ─── Geo helpers ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371

function toRad(deg) {
  return (deg * Math.PI) / 180
}

function haversineDistance(a, b) {
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
function computeBearing(a, b) {
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
function bearingDifference(a, b) {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

// ─── Thresholds ────────────────────────────────────────────────────────────────

const MAX_BEARING_DIFF = 30 // degrees
const MAX_PICKUP_KM = 5
const MAX_DROPOFF_KM = 5

// Near-3 threshold retained for tier classification heuristic
const NEAR_3_MAX_WARD_DISTANCE_KM = 5

// ─── Scoring weights ──────────────────────────────────────────────────────────

const W_DIRECTION = 0.3
const W_PICKUP = 0.25
const W_DROPOFF = 0.25
const W_TIME = 0.2

// ─── Component score functions ────────────────────────────────────────────────

function directionScore(routeBearing, planBearing) {
  const diff = bearingDifference(routeBearing, planBearing)
  // Linear: 0° diff → 1.0, 30° diff → 0.0
  return Math.max(0, 1 - diff / MAX_BEARING_DIFF)
}

function proximityScore(distKm, maxKm) {
  return Math.max(0, 1 - distKm / maxKm)
}

/**
 * Time overlap score: 1.0 when departure is at block center, 0.0 at edges.
 * route has a single departureTime; group/plan exposes departureBlockStart/End.
 */
function timeOverlapScore(departureTime, blockStart, blockEnd) {
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
function estimateDetour(pickupDist, dropoffDist) {
  return Math.round(((pickupDist + dropoffDist) / 30) * 60)
}

// ─── Hard Filters ─────────────────────────────────────────────────────────────

/**
 * Reject candidates that fail any hard constraint.
 * route: { serviceDate, departureTime, origin, destination, driverId }
 * planLike: { serviceDate, departureBlockStart, departureBlockEnd, pickup, dropoff }
 * driver: { blockedUserIds } | null
 * clientIds: string[] — all client IDs to check for bidirectional block
 */
async function passesHardFilters(route, planLike, driver, clientIds) {
  if (route.serviceDate !== planLike.serviceDate) return false

  // Departure block overlap
  const routeBlock = store.computeDepartureBlock(route.departureTime)
  const blockOverlaps =
    routeBlock.start < planLike.departureBlockEnd &&
    planLike.departureBlockStart < routeBlock.end
  if (!blockOverlaps) return false

  // Bidirectional blocked-user check
  if (driver) {
    const ids = Array.isArray(clientIds) ? clientIds : []
    for (const clientId of ids) {
      const client = await store.getUser(clientId)
      if (
        client &&
        (driver.blockedUserIds.includes(clientId) ||
          client.blockedUserIds.includes(driver.id))
      ) {
        return false
      }
    }
  }

  // Direction
  const routeBearing = computeBearing(route.origin, route.destination)
  const planBearing = computeBearing(planLike.pickup, planLike.dropoff)
  if (bearingDifference(routeBearing, planBearing) > MAX_BEARING_DIFF)
    return false

  // Pickup proximity
  if (haversineDistance(route.origin, planLike.pickup) > MAX_PICKUP_KM)
    return false

  // Dropoff proximity
  if (haversineDistance(route.destination, planLike.dropoff) > MAX_DROPOFF_KM)
    return false

  return true
}

// ─── Score computation ────────────────────────────────────────────────────────

/**
 * Compute scoring fields for a route vs planLike pair.
 * Returns { matchScore, pickupFit, dropoffFit, timeFit, detourEstimate }.
 */
function computeMatchScore(route, planLike) {
  const pickupDist = haversineDistance(route.origin, planLike.pickup)
  const dropoffDist = haversineDistance(route.destination, planLike.dropoff)
  const routeBearing = computeBearing(route.origin, route.destination)
  const planBearing = computeBearing(planLike.pickup, planLike.dropoff)

  const dir = directionScore(routeBearing, planBearing)
  const pickup = proximityScore(pickupDist, MAX_PICKUP_KM)
  const dropoff = proximityScore(dropoffDist, MAX_DROPOFF_KM)
  const time = timeOverlapScore(
    route.departureTime,
    planLike.departureBlockStart,
    planLike.departureBlockEnd,
  )
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

// ─── Tier classification ──────────────────────────────────────────────────────

/**
 * Classify match tier from pickup/dropoff distances.
 * Returns 'exact_3', 'near_3', or null.
 */
function classifyByDistance(pickupDist, dropoffDist) {
  if (pickupDist < 1.0 && dropoffDist < 1.0) return 'exact_3'
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
 * Returns null if not eligible.
 */
function classifyMatch(route, group) {
  if (route.serviceDate !== group.serviceDate) return null

  const routeBlock = store.computeDepartureBlock(route.departureTime)
  const blockOverlaps =
    routeBlock.start < group.departureBlockEnd &&
    group.departureBlockStart < routeBlock.end
  if (!blockOverlaps) return null

  return classifyByDistance(
    haversineDistance(route.origin, group.pickup),
    haversineDistance(route.destination, group.dropoff),
  )
}

/**
 * Compute visibility mode based on match tier and member count.
 */
function computeVisibilityMode(matchTier, memberCount) {
  if (matchTier === 'exact_3' && memberCount === 1) return 'single_client_card'
  if (matchTier === 'exact_3' && memberCount > 1)
    return 'group_with_client_list'
  return 'group_summary_only'
}

/**
 * Sort match results: exact_3 first, near_3 second; within tier sort by matchScore desc.
 */
function sortByTierThenScore(a, b) {
  if (a.matchTier === 'exact_3' && b.matchTier !== 'exact_3') return -1
  if (a.matchTier !== 'exact_3' && b.matchTier === 'exact_3') return 1
  return b.matchScore - a.matchScore
}

// ─── Main matching functions ──────────────────────────────────────────────────

/**
 * For a given route, compute all matched demand groups with tier/visibility/score.
 */
async function computeMatchedDemandGroups(routeId) {
  const route = await store.getRoute(routeId)
  if (!route) return []

  const driver = await store.getUser(route.driverId)
  const groups = await store.deriveDemandGroups()
  const results = []

  for (const group of groups) {
    const matchTier = classifyMatch(route, group)
    if (!matchTier) continue

    // Apply hard filters (includes blocked-user check)
    const passed = await passesHardFilters(
      route,
      group,
      driver,
      group.clientIds,
    )
    if (!passed) continue

    const visibilityMode = computeVisibilityMode(matchTier, group.memberCount)
    const scores = computeMatchScore(route, group)

    results.push({
      demandGroupId: group.id,
      matchTier,
      visibilityMode,
      tripPrice: route.tripPrice,
      serviceDate: group.serviceDate,
      pickupWardId: group.pickupWardId,
      dropoffWardId: group.dropoffWardId,
      pickupWardKey: group.pickupWardKey,
      dropoffWardKey: group.dropoffWardKey,
      pickupProvinceId: group.pickupProvinceId,
      dropoffProvinceId: group.dropoffProvinceId,
      departureBlockStart: group.departureBlockStart,
      departureBlockEnd: group.departureBlockEnd,
      memberCount: group.memberCount,
      totalPassengerCount: group.totalPassengerCount,
      ...scores,
    })
  }

  results.sort(sortByTierThenScore)

  return results
}

/**
 * For a search_only trip plan, find eligible routes with scores.
 */
async function computeMatchingRoutes(tripPlanId) {
  const tp = await store.getTripPlan(tripPlanId)
  if (!tp) return null
  if (tp.publishMode !== 'search_only') {
    throw new Error(
      'Only search_only trip plans can search for matching routes',
    )
  }

  const allRoutes = await store.listAllRoutes()
  const results = []

  for (const route of allRoutes) {
    if (route.status !== 'published') continue

    const driver = await store.getUser(route.driverId)

    // Apply hard filters
    const passed = await passesHardFilters(route, tp, driver, [tp.clientId])
    if (!passed) continue

    // Tier classification (reuses shared helper)
    const pickupDist = haversineDistance(route.origin, tp.pickup)
    const dropoffDist = haversineDistance(route.destination, tp.dropoff)
    const matchTier = classifyByDistance(pickupDist, dropoffDist)
    if (!matchTier) continue

    const scores = computeMatchScore(route, tp)
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

module.exports = {
  // Geo helpers (exported for tests)
  haversineDistance,
  computeBearing,
  bearingDifference,
  // Scoring helpers (exported for tests)
  directionScore,
  proximityScore,
  timeOverlapScore,
  estimateDetour,
  passesHardFilters,
  computeMatchScore,
  // Thresholds (exported for tests)
  MAX_BEARING_DIFF,
  MAX_PICKUP_KM,
  MAX_DROPOFF_KM,
  // Existing exports
  computeVisibilityMode,
  computeMatchedDemandGroups,
  computeMatchingRoutes,
}
