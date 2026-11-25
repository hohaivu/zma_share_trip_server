import { parseNumeric, toCamelCase } from '../db/utils'
import { Route } from '../types/entities'
import { HttpError } from '../http-error'

export type DbQueryExecutor = {
  query: (
    sql: string,
    params: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}

export function mapRoute(row: Record<string, unknown>): Route {
  const route = toCamelCase<Route>(row)
  if (!route) throw new Error('Cannot map null row to Route')
  route.tripPrice = parseNumeric(route.tripPrice)
  return route
}

export const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE route_id = ? AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM route_requests WHERE route_id = ? AND status = 'accepted'
`

export async function checkRouteAvailability(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<boolean> {
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId, routeId])
  return result.rowCount === 0
}

export async function loadRouteForUpdateTx(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<Route> {
  const result = await executor.query(
    'SELECT * FROM routes WHERE id = ? FOR UPDATE',
    [routeId],
  )
  if (!result.rows[0]) throw new HttpError(404, 'Route not found')
  return mapRoute(result.rows[0])
}
