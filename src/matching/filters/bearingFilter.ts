import { computeBearing, bearingDifference, hasUsableGeometry } from '../geo'
import { MAX_BEARING_DIFF } from '../thresholds'
import { GeoCandidate } from '../../types/payloads'
import { HardFilter } from '../ports'

export const bearingFilter: HardFilter<GeoCandidate, GeoCandidate> = {
  name: 'bearingFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    if (ctx.adminExact) return true
    if (!hasUsableGeometry(candidate, query)) return true
    const candidateBearing = computeBearing(candidate.origin, candidate.destination)
    const queryBearing = computeBearing(query.origin, query.destination)
    return bearingDifference(candidateBearing, queryBearing) <= MAX_BEARING_DIFF
  },
}
