import { haversineDistance, hasUsableGeometry } from '../geo'
import { MAX_PICKUP_KM, MAX_DROPOFF_KM } from '../thresholds'
import { RouteLike, PlanLike } from '../../types/payloads'
import { HardFilter } from '../ports'

export const proximityFilter: HardFilter<PlanLike, RouteLike> = {
  name: 'proximityFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    if (ctx.adminExact) return true
    if (!hasUsableGeometry(candidate, query)) return false

    if (haversineDistance(candidate.origin, query.origin) > MAX_PICKUP_KM) return false
    if (haversineDistance(candidate.destination, query.destination) > MAX_DROPOFF_KM) return false

    return true
  },
}
