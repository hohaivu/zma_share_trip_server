import { User } from '../types/entities'

export interface FilterContext {
  driver: User | null
  userCache: Map<string, User | null>
  blockedUserCache: Map<string, string[]>
  routeAvailableCache: Map<string, boolean>
  dateBlockCache: Map<string, boolean>
  matchTier?: 'exact_3' | 'near_3'
  /** Set by tierFilter. When true, bearing and proximity filters must pass through. */
  adminExact?: boolean
  routeBearing?: number
  planBearing?: number
}

export interface CandidateSource<Q, C> {
  list(query: Q, ctx: FilterContext): Promise<C[]>
}

// Geometry filters MUST honor ctx.adminExact === true and return true without checking geometry.
export interface HardFilter<Q, C> {
  name: string
  passes(candidate: C, query: Q, ctx: FilterContext): Promise<boolean>
}
