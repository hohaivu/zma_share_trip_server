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

export function routePlanWindowsOverlap(
  routeStart: string,
  routeEnd: string,
  planStart: string,
  planEnd: string,
): boolean {
  const routeStartMs =
    new Date(routeStart).getTime() -
    MATCHING_ROUTE_BLOCK_EXPAND_BEFORE_MINUTES * MS_PER_MINUTE
  const routeEndMs =
    new Date(routeEnd).getTime() + MATCHING_ROUTE_BLOCK_EXPAND_AFTER_MINUTES * MS_PER_MINUTE
  const planStartMs = new Date(planStart).getTime()
  const planEndMs = new Date(planEnd).getTime()
  return routeStartMs <= planEndMs && planStartMs <= routeEndMs
}

function buildBlockKey(
  candidate: WithWindow,
  query: QueryWindow,
): string {
  return `${candidate.departureWindowStartDate}|${candidate.departureWindowEndDate}|${query.departureWindowStartDate}|${query.departureWindowEndDate}`
}

export const clientBlockOverlapFilter: HardFilter<QueryWindow, WithWindow> = {
  name: 'clientBlockOverlapFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    const key = buildBlockKey(candidate, query)
    const cached = ctx.dateBlockCache.get(key)
    if (cached !== undefined) return cached
    const result = routePlanWindowsOverlap(
      candidate.departureWindowStartDate,
      candidate.departureWindowEndDate,
      query.departureWindowStartDate,
      query.departureWindowEndDate,
    )
    ctx.dateBlockCache.set(key, result)
    return result
  },
}

export const driverBlockOverlapFilter: HardFilter<QueryWindow, WithWindow> = {
  name: 'driverBlockOverlapFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    const key = buildBlockKey(candidate, query)
    const cached = ctx.dateBlockCache.get(key)
    if (cached !== undefined) return cached
    const result = routePlanWindowsOverlap(
      query.departureWindowStartDate,
      query.departureWindowEndDate,
      candidate.departureWindowStartDate,
      candidate.departureWindowEndDate,
    )
    ctx.dateBlockCache.set(key, result)
    return result
  },
}
