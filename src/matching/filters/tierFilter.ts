import { GeoCandidate } from '../../types/payloads'
import { classifyByAdminAndDistance, hasExactAdminMatch } from '../tier'
import { HardFilter } from '../ports'

export const tierFilter: HardFilter<GeoCandidate, GeoCandidate> = {
  name: 'tierFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    const tier = classifyByAdminAndDistance(candidate, query)
    if (!tier) return false
    ctx.matchTier = tier
    ctx.adminExact = hasExactAdminMatch(candidate, query)
    return true
  },
}
