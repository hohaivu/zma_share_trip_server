const store = require('./store')

// ─── Geo helpers (retained for near-3 heuristic) ──────────────────────────────

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

// Near-3 threshold: ward-pair distance within this km to be considered "near"
const NEAR_3_MAX_WARD_DISTANCE_KM = 5

// ─── Matching Logic ────────────────────────────────────────────────────────────

/**
 * Classify a demand group against a route as exact_3 or near_3.
 * exact_3: same service date + same pickup ward + same dropoff ward + overlapping departure block
 * near_3: same service date + nearby wards (within threshold) + overlapping departure block
 * Returns null if not eligible.
 */
function classifyMatch(route, group) {
  // Must share service date
  if (route.serviceDate !== group.serviceDate) return null

  // Check departure block overlap
  const routeBlock = store.computeDepartureBlock(route.departureTime)
  const blockOverlaps =
    routeBlock.start < group.departureBlockEnd &&
    group.departureBlockStart < routeBlock.end
  if (!blockOverlaps) return null

  // Exact-3: normalized ward match
  // We compare route origin/destination wards vs group pickup/dropoff wards.
  // For demo, we check using a simple ward-proximity heuristic since routes
  // don't have explicit ward IDs — we use geo proximity as a stand-in.

  // If we had ward IDs on routes, we'd do:
  //   route.pickupWardId === group.pickupWardId && route.dropoffWardId === group.dropoffWardId
  // For the demo, use geo-distance from route endpoints to determine ward match:
  const pickupDist = haversineDistance(route.origin, { lat: 10.7769, lng: 106.7009 }) // representative ward center
  const dropoffDist = haversineDistance(route.destination, { lat: 10.8544, lng: 106.7539 })

  // Simple heuristic: very close = exact_3, somewhat close = near_3
  const isExactPickup = pickupDist < 1.0 // within 1km = same ward
  const isExactDropoff = dropoffDist < 1.0
  const isNearPickup = pickupDist < NEAR_3_MAX_WARD_DISTANCE_KM
  const isNearDropoff = dropoffDist < NEAR_3_MAX_WARD_DISTANCE_KM

  if (isExactPickup && isExactDropoff) return 'exact_3'
  if (isNearPickup && isNearDropoff) return 'near_3'
  return null
}

/**
 * Compute visibility mode based on match tier and member count.
 */
function computeVisibilityMode(matchTier, memberCount) {
  if (matchTier === 'exact_3' && memberCount === 1) return 'single_client_card'
  if (matchTier === 'exact_3' && memberCount > 1) return 'group_with_client_list'
  return 'group_summary_only'
}

/**
 * Sort match results: exact_3 first, then near_3.
 */
function sortByMatchTier(a, b) {
  if (a.matchTier === 'exact_3' && b.matchTier !== 'exact_3') return -1
  if (a.matchTier !== 'exact_3' && b.matchTier === 'exact_3') return 1
  return 0
}

/**
 * For a given route, compute all matched demand groups with tier/visibility.
 */
function computeMatchedDemandGroups(routeId) {
  const route = store.getRoute(routeId)
  if (!route) return []

  const groups = store.deriveDemandGroups()
  const results = []

  for (const group of groups) {
    const matchTier = classifyMatch(route, group)
    if (!matchTier) continue

    const visibilityMode = computeVisibilityMode(matchTier, group.memberCount)

    results.push({
      demandGroupId: group.id,
      matchTier,
      visibilityMode,
      tripPrice: route.tripPrice,
      serviceDate: group.serviceDate,
      pickupWardId: group.pickupWardId,
      dropoffWardId: group.dropoffWardId,
      departureBlockStart: group.departureBlockStart,
      departureBlockEnd: group.departureBlockEnd,
      memberCount: group.memberCount,
      totalPassengerCount: group.totalPassengerCount,
    })
  }

  results.sort(sortByMatchTier)

  return results
}

/**
 * For a search_only trip plan, find eligible routes.
 */
function computeMatchingRoutes(tripPlanId) {
  const tp = store.getTripPlan(tripPlanId)
  if (!tp) return null
  if (tp.publishMode !== 'search_only') {
    throw new Error('Only search_only trip plans can search for matching routes')
  }

  const allRoutes = store.listAllRoutes()
  const results = []

  for (const route of allRoutes) {
    if (route.status !== 'published') continue
    if (route.serviceDate !== tp.serviceDate) continue

    // Check departure block overlap
    const routeBlock = store.computeDepartureBlock(route.departureTime)
    const blockOverlaps =
      routeBlock.start < tp.departureBlockEnd &&
      tp.departureBlockStart < routeBlock.end
    if (!blockOverlaps) continue

    // Proximity check for ward match (demo heuristic)
    const pickupDist = haversineDistance(route.origin, tp.pickup)
    const dropoffDist = haversineDistance(route.destination, tp.dropoff)

    let matchTier = null
    if (pickupDist < 1.0 && dropoffDist < 1.0) matchTier = 'exact_3'
    else if (pickupDist < NEAR_3_MAX_WARD_DISTANCE_KM && dropoffDist < NEAR_3_MAX_WARD_DISTANCE_KM) matchTier = 'near_3'
    if (!matchTier) continue

    // Enrich with driver info
    const driver = store.getUser(route.driverId)

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
      routeAvailable: store.isRouteAvailable(route.id),
    })
  }

  results.sort(sortByMatchTier)

  return results
}

module.exports = {
  haversineDistance,
  computeVisibilityMode,
  computeMatchedDemandGroups,
  computeMatchingRoutes,
}
