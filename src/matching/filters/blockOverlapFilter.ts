import { computeDepartureBlock } from '../../domain/departureBlock'
import {
  MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES,
  MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES,
  MS_PER_MINUTE,
} from '../thresholds'
import { HardFilter } from '../ports'

interface WithWindow {
  departureDate: string
  windowEnd: string
}

interface QueryWindow {
  windowStart: string
  windowEnd: string
}

export function blocksOverlap(
  routeDepartureDate: string,
  routeWindowEnd: string | undefined,
  windowStart: string,
  windowEnd: string,
): boolean {
  const routeBlock = computeDepartureBlock(routeDepartureDate)
  const routeSpanEndMs = routeWindowEnd
    ? new Date(routeWindowEnd).getTime()
    : new Date(routeBlock.end).getTime()
  const routeStartMs =
    new Date(routeBlock.start).getTime() -
    MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES * MS_PER_MINUTE
  const routeEndMs =
    routeSpanEndMs + MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES * MS_PER_MINUTE
  const planStartMs = new Date(windowStart).getTime()
  const planEndMs = new Date(windowEnd).getTime()
  return routeStartMs <= planEndMs && planStartMs <= routeEndMs
}

function buildBlockKey(
  candidate: WithWindow,
  query: QueryWindow,
): string {
  return `${candidate.departureDate}|${candidate.windowEnd}|${query.windowStart}|${query.windowEnd}`
}

export const blockOverlapFilter: HardFilter<QueryWindow, WithWindow> = {
  name: 'blockOverlapFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    const key = buildBlockKey(candidate, query)
    const cached = ctx.dateBlockCache.get(key)
    if (cached !== undefined) return cached
    const result = blocksOverlap(
      candidate.departureDate,
      candidate.windowEnd,
      query.windowStart,
      query.windowEnd,
    )
    ctx.dateBlockCache.set(key, result)
    return result
  },
}
