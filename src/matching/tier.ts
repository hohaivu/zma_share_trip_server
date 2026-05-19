import { haversineDistance, hasUsableGeometry } from './geo'
import { NEAR_3_MAX_WARD_DISTANCE_KM } from './thresholds'
import { RouteLike, PlanLike } from '../types/payloads'

export function hasExactAdminMatch(route: RouteLike, planLike: PlanLike): boolean {
  return (
    !!route?.originWardId &&
    !!planLike?.originWardId &&
    route.originWardId === planLike.originWardId &&
    route.originProvinceId === planLike.originProvinceId &&
    !!route?.destinationWardId &&
    !!planLike?.destinationWardId &&
    route.destinationWardId === planLike.destinationWardId &&
    route.destinationProvinceId === planLike.destinationProvinceId
  )
}

export function classifyByAdminAndDistance(
  route: RouteLike,
  planLike: PlanLike,
): 'exact_3' | 'near_3' | null {
  if (hasExactAdminMatch(route, planLike)) return 'exact_3'

  if (!hasUsableGeometry(route, planLike)) return null

  const pickupDist = haversineDistance(route.origin, planLike.origin)
  const dropoffDist = haversineDistance(route.destination, planLike.destination)

  if (pickupDist < 1.0 && dropoffDist < 1.0) return 'exact_3'

  if (
    pickupDist < NEAR_3_MAX_WARD_DISTANCE_KM &&
    dropoffDist < NEAR_3_MAX_WARD_DISTANCE_KM
  ) {
    return 'near_3'
  }
  return null
}

export function computeVisibilityMode(
  matchTier: string,
  memberCount: number,
): 'single_client_card' | 'group_with_client_list' | 'group_summary_only' {
  if (matchTier === 'exact_3' && memberCount === 1) return 'single_client_card'
  if (matchTier === 'exact_3' && memberCount > 1) return 'group_with_client_list'
  return 'group_summary_only'
}
