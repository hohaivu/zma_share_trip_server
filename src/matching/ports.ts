import { User } from '../types/entities'

export interface FilterContext {
  driver: User | null
  userCache: Map<string, User | null>
  blockedUserCache: Map<string, string[]>
  routeAvailableCache: Map<string, boolean>
  dateBlockCache: Map<string, boolean>
  matchTier?: 'exact_3' | 'near_3'
  /** Set by tierFilter when admin codes match exactly; downstream geometry filters short-circuit to true. */
  adminExact?: boolean
}

export interface CandidateSource<Q, C> {
  list(query: Q, ctx: FilterContext): Promise<C[]>
}

export interface HardFilter<Q, C> {
  name: string
  passes(candidate: C, query: Q, ctx: FilterContext): Promise<boolean>
}
