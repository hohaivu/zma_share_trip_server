import { computeBearing, bearingDifference, hasUsableGeometry } from '../geo'
import { MAX_BEARING_DIFF } from '../thresholds'
import { RouteLike, PlanLike } from '../../types/payloads'
import { HardFilter } from '../ports'

export const bearingFilter: HardFilter<PlanLike, RouteLike> = {
  name: 'bearingFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    if (ctx.adminExact) return true
    if (!hasUsableGeometry(candidate, query)) return true

    const routeBearing = ctx.routeBearing ?? computeBearing(candidate.origin, candidate.destination)
    const planBearing = ctx.planBearing ?? computeBearing(query.origin, query.destination)
    ctx.routeBearing = routeBearing
    ctx.planBearing = planBearing

    return bearingDifference(routeBearing, planBearing) <= MAX_BEARING_DIFF
  },
}
