import {
  haversineDistance,
  computeBearing,
  bearingDifference,
  hasUsableGeometry,
} from './geo'
import { MAX_BEARING_DIFF, MAX_PICKUP_KM, MAX_DROPOFF_KM, W_DIRECTION, W_PICKUP, W_DROPOFF, W_TIME } from './thresholds'
import { hasExactAdminMatch } from './tier'
import { RouteLike, PlanLike, ScoreFields } from '../types/payloads'

export function directionScore(routeBearing: number, planBearing: number): number {
  const diff = bearingDifference(routeBearing, planBearing)
  return Math.max(0, 1 - diff / MAX_BEARING_DIFF)
}

export function proximityScore(distKm: number, maxKm: number): number {
  return Math.max(0, 1 - distKm / maxKm)
}

export function timeOverlapScore(
  routeDepartureWindowStartDate: string,
  planDepartureWindowStartDate: string,
  planDepartureWindowEndDate: string,
): number {
  const rTime = new Date(routeDepartureWindowStartDate).getTime()
  const dStart = new Date(planDepartureWindowStartDate).getTime()
  const dEnd = new Date(planDepartureWindowEndDate).getTime()
  const blockDuration = dEnd - dStart
  if (blockDuration <= 0) return rTime === dStart ? 1 : 0
  const distToCenter = Math.abs(rTime - (dStart + blockDuration / 2))
  return Math.max(0, 1 - distToCenter / (blockDuration / 2))
}

export function estimateDetour(pickupDist: number, dropoffDist: number): number {
  return Math.round(((pickupDist + dropoffDist) / 30) * 60)
}

function weightedMatchScore(
  direction: number,
  pickup: number,
  dropoff: number,
  time: number,
): number {
  return Math.round(
    (direction * W_DIRECTION +
      pickup * W_PICKUP +
      dropoff * W_DROPOFF +
      time * W_TIME) *
      100,
  )
}

function computeMatchScoreWithBearings(
  route: RouteLike,
  planLike: PlanLike,
  routeBearing: number,
  planBearing: number,
): ScoreFields {
  const time = timeOverlapScore(
    route.departureWindowStartDate,
    planLike.departureWindowStartDate,
    planLike.departureWindowEndDate,
  )

  if (!hasUsableGeometry(route, planLike)) {
    const fallbackFit = hasExactAdminMatch(route, planLike) ? 1 : 0
    return {
      matchScore: weightedMatchScore(fallbackFit, fallbackFit, fallbackFit, time),
      originFit: fallbackFit,
      destinationFit: fallbackFit,
      originDistanceKm: 0,
      destinationDistanceKm: 0,
      timeFit: time,
      detourEstimate: 0,
    }
  }

  const pickupDist = haversineDistance(route.origin, planLike.origin)
  const dropoffDist = haversineDistance(route.destination, planLike.destination)

  const dir = directionScore(routeBearing, planBearing)
  const pickup = proximityScore(pickupDist, MAX_PICKUP_KM)
  const dropoff = proximityScore(dropoffDist, MAX_DROPOFF_KM)

  return {
    matchScore: weightedMatchScore(dir, pickup, dropoff, time),
    originFit: pickup,
    destinationFit: dropoff,
    originDistanceKm: pickupDist,
    destinationDistanceKm: dropoffDist,
    timeFit: time,
    detourEstimate: estimateDetour(pickupDist, dropoffDist),
  }
}

export function computeMatchScore(route: RouteLike, planLike: PlanLike): ScoreFields {
  const routeBearing = computeBearing(route.origin, route.destination)
  const planBearing = computeBearing(planLike.origin, planLike.destination)
  return computeMatchScoreWithBearings(route, planLike, routeBearing, planBearing)
}

export { computeMatchScoreWithBearings }
