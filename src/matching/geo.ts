export const EARTH_RADIUS_KM = 6371

interface LatLng {
  lat: number
  lng: number
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

export function computeBearing(a: LatLng, b: LatLng): number {
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

export function bearingDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

export function hasUsablePoint(point: LatLng | null | undefined): boolean {
  if (!point) return false
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return !(lat === 0 && lng === 0)
}

interface RouteOrPlanGeometry {
  origin: LatLng | null
  destination: LatLng | null
}

export function hasUsableGeometry(
  routeLike: RouteOrPlanGeometry,
  planLike: RouteOrPlanGeometry,
): boolean {
  return (
    hasUsablePoint(routeLike.origin) &&
    hasUsablePoint(routeLike.destination) &&
    hasUsablePoint(planLike.origin) &&
    hasUsablePoint(planLike.destination)
  )
}
