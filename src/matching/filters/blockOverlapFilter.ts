import { computeDepartureBlock } from '../../domain/departureBlock'
import {
  MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES,
  MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES,
  MS_PER_MINUTE,
} from '../thresholds'
import { HardFilter } from '../ports'

interface WithWindow {
  departureWindowStartDate: string
  departureWindowEndDate: string
}

interface QueryWindow {
  departureWindowStartDate: string
  departureWindowEndDate: string
}

export function blocksOverlap(
  routeDepartureWindowStartDate: string,
  routeDepartureWindowEndDate: string | undefined,
  departureWindowStartDate: string,
  departureWindowEndDate: string,
): boolean {
  const routeBlock = computeDepartureBlock(routeDepartureWindowStartDate)
  const routeSpanEndMs = routeDepartureWindowEndDate
    ? new Date(routeDepartureWindowEndDate).getTime()
    : new Date(routeBlock.end).getTime()
  const routeStartMs =
    new Date(routeBlock.start).getTime() -
    MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES * MS_PER_MINUTE
  const routeEndMs =
    routeSpanEndMs + MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES * MS_PER_MINUTE
  const planStartMs = new Date(departureWindowStartDate).getTime()
  const planEndMs = new Date(departureWindowEndDate).getTime()
  return routeStartMs <= planEndMs && planStartMs <= routeEndMs
}

function buildBlockKey(
  candidate: WithWindow,
  query: QueryWindow,
): string {
  return `${candidate.departureWindowStartDate}|${candidate.departureWindowEndDate}|${query.departureWindowStartDate}|${query.departureWindowEndDate}`
}

export const blockOverlapFilter: HardFilter<QueryWindow, WithWindow> = {
  name: 'blockOverlapFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    const key = buildBlockKey(candidate, query)
    const cached = ctx.dateBlockCache.get(key)
    if (cached !== undefined) return cached
    const result = blocksOverlap(
      candidate.departureWindowStartDate,
      candidate.departureWindowEndDate,
      query.departureWindowStartDate,
      query.departureWindowEndDate,
    )
    ctx.dateBlockCache.set(key, result)
    return result
  },
}
