const { Router } = require('express')
const store = require('../store')

const router = Router()

const MAX_BEARING_DIFF = 30
const MAX_PICKUP_KM = 5
const MAX_DROPOFF_KM = 5

const W_DIRECTION = 0.3
const W_PICKUP = 0.25
const W_DROPOFF = 0.25
const W_TIME = 0.2

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

function bearingDifference(a, b) {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

function sameDate(a, b) {
  return a.slice(0, 10) === b.slice(0, 10)
}

function windowsOverlap(route, demand) {
  const rStart = new Date(route.windowStart).getTime()
  const rEnd = new Date(route.windowEnd).getTime()
  const dStart = new Date(demand.windowStart).getTime()
  const dEnd = new Date(demand.windowEnd).getTime()
  return rStart <= dEnd && dStart <= rEnd
}

function directionScore(route, demand) {
  const routeBearing = computeBearing(route.origin, route.destination)
  const demandBearing = computeBearing(demand.pickup, demand.dropoff)
  const diff = bearingDifference(routeBearing, demandBearing)
  return Math.max(0, 1 - diff / MAX_BEARING_DIFF)
}

function proximityScore(distKm, maxKm) {
  return Math.max(0, 1 - distKm / maxKm)
}

function timeOverlapScore(route, demand) {
  const rStart = new Date(route.windowStart).getTime()
  const rEnd = new Date(route.windowEnd).getTime()
  const dStart = new Date(demand.windowStart).getTime()
  const dEnd = new Date(demand.windowEnd).getTime()

  const overlapStart = Math.max(rStart, dStart)
  const overlapEnd = Math.min(rEnd, dEnd)
  const overlap = Math.max(0, overlapEnd - overlapStart)

  const shortest = Math.min(rEnd - rStart, dEnd - dStart)
  if (shortest <= 0) return 0
  return overlap / shortest
}

function estimateDetour(route, demand) {
  const pickupDetourKm = haversineDistance(route.origin, demand.pickup)
  const dropoffDetourKm = haversineDistance(route.destination, demand.dropoff)
  return ((pickupDetourKm + dropoffDetourKm) / 30) * 60
}

function assignLabels(components) {
  const labels = []

  if (components.score >= 85 && components.detourEstimate < 5) {
    labels.push('rat_phu_hop')
  }

  if (components.directionSimilarity >= 0.9) {
    labels.push('cung_tuyen')
  }

  if (components.pickupDistance < 2) {
    labels.push('thuan_duong_don')
  }

  if (components.dropoffDistance < 2) {
    labels.push('thuan_duong_tra')
  }

  if (components.timeFit >= 0.5 && components.timeFit <= 0.8) {
    labels.push('lech_nhe_gio_di')
  }

  return labels
}

function isBlocked(driver, client) {
  if (!driver || !client) return false
  return (
    driver.blockedUserIds.includes(client.id) ||
    client.blockedUserIds.includes(driver.id)
  )
}

function computeMatchCandidate(route, demand, getUser) {
  const driver = getUser(route.driverId)
  const client = getUser(demand.clientId)

  if (!sameDate(route.departureTime, demand.desiredTime)) return null
  if (!windowsOverlap(route, demand)) return null
  if (route.availableSeats < demand.passengerCount) return null
  if (isBlocked(driver, client)) return null

  const routeBearing = computeBearing(route.origin, route.destination)
  const demandBearing = computeBearing(demand.pickup, demand.dropoff)
  if (bearingDifference(routeBearing, demandBearing) > MAX_BEARING_DIFF) {
    return null
  }

  const pickupDist = haversineDistance(route.origin, demand.pickup)
  if (pickupDist > MAX_PICKUP_KM) return null

  const dropoffDist = haversineDistance(route.destination, demand.dropoff)
  if (dropoffDist > MAX_DROPOFF_KM) return null

  const dir = directionScore(route, demand)
  const pickup = proximityScore(pickupDist, MAX_PICKUP_KM)
  const dropoff = proximityScore(dropoffDist, MAX_DROPOFF_KM)
  const time = timeOverlapScore(route, demand)
  const detour = estimateDetour(route, demand)

  const score = Math.round(
    (dir * W_DIRECTION +
      pickup * W_PICKUP +
      dropoff * W_DROPOFF +
      time * W_TIME) *
      100,
  )

  return {
    driverRouteId: route.id,
    clientDemandId: demand.id,
    score,
    pickupFit: pickup,
    dropoffFit: dropoff,
    timeFit: time,
    detourEstimate: Math.round(detour),
    labels: assignLabels({
      score,
      directionSimilarity: dir,
      pickupDistance: pickupDist,
      dropoffDistance: dropoffDist,
      timeFit: time,
      detourEstimate: detour,
    }),
  }
}

router.get('/matches', (req, res) => {
  const { tripId } = req.query
  if (!tripId) {
    return res.status(400).json({ message: 'tripId query is required' })
  }

  const route = store.getRoute(tripId)
  const demand = store.getDemand(tripId)

  if (!route && !demand) {
    return res.status(200).json([])
  }

  const getUser = (userId) => store.getUser(userId)

  if (route) {
    const results = store
      .listAllDemands()
      .filter((candidate) => candidate.status === 'published')
      .map((candidate) => computeMatchCandidate(route, candidate, getUser))
      .filter((candidate) => candidate !== null)
      .sort((a, b) => b.score - a.score)
      .map((candidate) => store.upsertMatch(candidate))

    return res.status(200).json(results)
  }

  const results = store
    .listAllRoutes()
    .filter((candidate) => candidate.status === 'published')
    .map((candidate) => computeMatchCandidate(candidate, demand, getUser))
    .filter((candidate) => candidate !== null)
    .sort((a, b) => b.score - a.score)
    .map((candidate) => store.upsertMatch(candidate))

  return res.status(200).json(results)
})

module.exports = router
