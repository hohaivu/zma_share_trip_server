import { query, withTransaction } from '../db/connection'
import {
  mapCounterpartyRow,
  parseLocationJson,
  parseNumeric,
  toCamelCase,
  toCamelCaseRecord,
} from '../db/utils'
import { HttpError } from '../http-error'
import { Plan, Route, RouteRequest } from '../types/entities'
import type { HydratedRouteRequest } from '../types/payloads'
import {
  type DbQueryExecutor,
  chargeRouteFeeTx,
  loadRouteForWalletTx,
} from './walletRepository'

function mapHydratedRouteRequestRow(
  row: Record<string, unknown>,
): HydratedRouteRequest {
  const r = toCamelCaseRecord(row)
  const counterparty = mapCounterpartyRow(r)

  const routeOrigin = parseLocationJson(r.routeOrigin)
  const routeDestination = parseLocationJson(r.routeDestination)
  const route =
    routeOrigin && routeDestination && r.routeDeparture && r.routeDepartureEnd
      ? {
          origin: routeOrigin,
          destination: routeDestination,
          departureWindowStartDate: r.routeDeparture as string,
          departureWindowEndDate: r.routeDepartureEnd as string,
        }
      : null

  const planPassengerCount =
    r.planPassengerCount != null ? Number(r.planPassengerCount) : null
  const plan =
    planPassengerCount != null
      ? {
          passengerCount: planPassengerCount,
          origin: parseLocationJson(r.planOrigin) ?? undefined,
          destination: parseLocationJson(r.planDestination) ?? undefined,
        }
      : null

  return {
    id: r.id as string,
    clientId: r.clientId as string,
    planId: (r.planId as string | null) ?? undefined,
    routeId: r.routeId as string,
    driverId: r.driverId as string,
    tripPrice: parseNumeric(r.tripPrice),
    note: (r.note as string | null) ?? undefined,
    status: r.status as string,
    createdAt: r.createdAt as string,
    counterparty,
    route,
    plan,
  }
}

function isMariadbDuplicateEntry(e: unknown): boolean {
  const err = e as Record<string, unknown>
  return err?.errno === 1062
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

function mapRoute(row: Record<string, unknown>): Route {
  const route = toCamelCase<Route>(row)
  if (!route) throw new Error('Cannot map null row to Route')
  route.tripPrice = parseNumeric(route.tripPrice)
  route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd)
  return route
}

function mapRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => toCamelCase<T>(row)!).filter(Boolean)
}

async function checkRouteAvailability(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<boolean> {
  const result = await executor.query(
    `
      SELECT 1 FROM group_offers WHERE route_id = ? AND status = 'accepted'
      UNION ALL
      SELECT 1 FROM route_requests WHERE route_id = ? AND status = 'accepted'
    `,
    [routeId, routeId],
  )
  return result.rowCount === 0
}

export async function createRouteRequest(
  clientId: string,
  planId: string | null | undefined,
  routeId: string,
  note?: string,
): Promise<{ routeRequest: RouteRequest; route: Route }> {
  return withTransaction(async (tx) => {
    const existingRes = await tx.query(
      `SELECT * FROM route_requests WHERE client_id = ? AND route_id = ? AND status IN ('pending', 'accepted')`,
      [clientId, routeId],
    )
    if (existingRes.rows.length > 0) {
      const existingReq = toCamelCase<RouteRequest>(existingRes.rows[0])
      throw HttpError.withSafeDetails(
        409,
        'Duplicate active request already exists',
        { existingRequest: existingReq! },
      )
    }

    if (planId) {
      const tpRes = await tx.query('SELECT * FROM plans WHERE id = ?', [planId])
      const tp = toCamelCase<Plan>(tpRes.rows[0])
      if (!tp) throw new HttpError(400, 'Plan not found')
    }

    const routeRes = await tx.query(
      'SELECT * FROM routes WHERE id = ? FOR UPDATE',
      [routeId],
    )
    if (!routeRes.rows[0]) throw new HttpError(404, 'Route not found')
    const route = mapRoute(routeRes.rows[0])

    if (!(await checkRouteAvailability(tx, routeId))) {
      throw new HttpError(
        409,
        'Route is not available — already has an accepted client',
      )
    }

    try {
      const sreqRes = await tx.query(
        `
          INSERT INTO route_requests (id, client_id, plan_id, route_id, driver_id, trip_price, note, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
          RETURNING *
        `,
        [
          generateId('sreq'),
          clientId,
          planId,
          routeId,
          route.driverId,
          route.tripPrice,
          note || '',
          'pending',
        ],
      )
      const routeRequest = toCamelCase<RouteRequest>(sreqRes.rows[0])
      if (!routeRequest) throw new Error('Failed to create search request')
      return { routeRequest, route }
    } catch (e: unknown) {
      if (isMariadbDuplicateEntry(e)) {
        const raceRes = await tx.query(
          `SELECT * FROM route_requests WHERE client_id = ? AND route_id = ? AND status IN ('pending', 'accepted')`,
          [clientId, routeId],
        )
        const existingReqRace = toCamelCase<RouteRequest>(raceRes.rows[0])
        throw HttpError.withSafeDetails(
          409,
          'Duplicate active request already exists (race)',
          { existingRequest: existingReqRace! },
        )
      }
      throw e
    }
  })
}

export async function getRoute(routeId: string): Promise<Route | null> {
  const result = await query('SELECT * FROM routes WHERE id = ?', [routeId])
  return result.rows[0] ? mapRoute(result.rows[0]) : null
}

export async function getPlan(planId?: string): Promise<Plan | null> {
  if (!planId) return null
  const result = await query('SELECT * FROM plans WHERE id = ?', [planId])
  return toCamelCase<Plan>(result.rows[0])
}

export async function acceptRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  return withTransaction(async (tx) => {
    const sreqRes = await tx.query(
      'SELECT * FROM route_requests WHERE id = ? FOR UPDATE',
      [requestId],
    )
    let sreq = toCamelCase<RouteRequest>(sreqRes.rows[0])
    if (!sreq) throw new HttpError(404, 'Search request not found')
    if (sreq.status === 'accepted') return sreq
    if (sreq.status !== 'pending') {
      throw new HttpError(
        409,
        `Cannot accept search request in status: ${sreq.status}`,
      )
    }

    const route = await loadRouteForWalletTx(tx, sreq.routeId, mapRoute)
    if (route.status !== 'published') {
      throw new HttpError(
        409,
        `Cannot accept search request on route in status: ${route.status}`,
      )
    }
    if (!(await checkRouteAvailability(tx, sreq.routeId))) {
      throw new HttpError(
        409,
        'Route is no longer available — another client was accepted first',
      )
    }

    await tx.query(
      "UPDATE route_requests SET status = 'accepted' WHERE id = ?",
      [requestId],
    )
    const updatedRes = await tx.query(
      'SELECT * FROM route_requests WHERE id = ?',
      [requestId],
    )
    sreq = toCamelCase<RouteRequest>(updatedRes.rows[0])
    if (!sreq) throw new Error('Failed to accept search request')

    await tx.query("UPDATE routes SET status = 'matched' WHERE id = ?", [
      sreq.routeId,
    ])
    if (sreq.planId) {
      await tx.query(
        "UPDATE plans SET status = 'matched' WHERE id = ? AND status = 'published'",
        [sreq.planId],
      )
    }
    await chargeRouteFeeTx(tx, route, mapRoute, {
      description: 'Route fee charged on accepted search request',
    })
    await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE route_id = ? AND status = 'pending'",
      [sreq.routeId],
    )
    await tx.query(
      "UPDATE route_requests SET status = 'closed' WHERE route_id = ? AND id != ? AND status = 'pending'",
      [sreq.routeId, requestId],
    )
    return sreq
  })
}

export async function declineRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  const sreqRes = await query('SELECT * FROM route_requests WHERE id = ?', [
    requestId,
  ])
  const sreq = toCamelCase<RouteRequest>(sreqRes.rows[0])
  if (!sreq) throw new Error('Search request not found')
  if (sreq.status !== 'pending')
    throw new Error(`Cannot decline search request in status: ${sreq.status}`)
  await query("UPDATE route_requests SET status = 'declined' WHERE id = ?", [
    requestId,
  ])
  const updatedRes = await query('SELECT * FROM route_requests WHERE id = ?', [
    requestId,
  ])
  const updated = toCamelCase<RouteRequest>(updatedRes.rows[0])
  if (!updated) throw new Error('Failed to decline search request')
  return updated
}

export async function cancelRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  const sreqRes = await query('SELECT * FROM route_requests WHERE id = ?', [
    requestId,
  ])
  const sreq = toCamelCase<RouteRequest>(sreqRes.rows[0])
  if (!sreq) throw new Error('Search request not found')
  if (sreq.status !== 'pending') {
    throw new HttpError(
      409,
      `Cannot cancel search request in status: ${sreq.status}`,
    )
  }
  await query("UPDATE route_requests SET status = 'canceled' WHERE id = ?", [
    requestId,
  ])
  const updatedRes = await query('SELECT * FROM route_requests WHERE id = ?', [
    requestId,
  ])
  const updated = toCamelCase<RouteRequest>(updatedRes.rows[0])
  if (!updated) throw new Error('Failed to cancel search request')
  return updated
}

export async function listRouteRequestsByDriver(
  driverId: string,
  statuses?: string[],
): Promise<HydratedRouteRequest[]> {
  const hasStatuses = statuses && statuses.length > 0
  const statusClause = hasStatuses
    ? `AND rr.status IN (${statuses!.map(() => '?').join(',')})`
    : ''
  const params = hasStatuses ? [driverId, ...statuses!] : [driverId]
  const result = await query(
    `
    SELECT rr.*,
           r.origin     AS route_origin,
           r.destination AS route_destination,
           r.departure_window_start_date AS route_departure,
           r.departure_window_end_date AS route_departure_end,
           p.passenger_count AS plan_passenger_count,
           p.origin     AS plan_origin,
           p.destination AS plan_destination,
           u.id         AS cp_id,
           u.display_name AS cp_display_name,
           u.avatar_url AS cp_avatar_url,
           u.rating_avg AS cp_rating_avg,
           u.trip_count AS cp_trip_count,
           u.verification_status AS cp_verification_status
    FROM route_requests rr
    JOIN users  u ON u.id = rr.client_id
    JOIN routes r ON r.id = rr.route_id
    LEFT JOIN plans p ON p.id = rr.plan_id
    WHERE rr.driver_id = ?
      ${statusClause}
      AND r.status NOT IN ('completed', 'canceled')
      AND (p.id IS NULL OR p.status NOT IN ('completed', 'canceled'))
    ORDER BY rr.created_at DESC, rr.id DESC
    `,
    params,
  )
  return result.rows.map(mapHydratedRouteRequestRow)
}

export async function listRouteRequestsByClient(
  clientId: string,
  statuses?: string[],
): Promise<RouteRequest[]> {
  const hasStatuses = statuses && statuses.length > 0
  const sql = hasStatuses
    ? `SELECT * FROM route_requests WHERE client_id = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at DESC, id DESC`
    : 'SELECT * FROM route_requests WHERE client_id = ? ORDER BY created_at DESC, id DESC'
  const params = hasStatuses ? [clientId, ...statuses] : [clientId]
  const requestsRes = await query(sql, params)
  return mapRows<RouteRequest>(requestsRes.rows)
}

export async function listRouteRequestsByRoute(
  routeId: string,
): Promise<RouteRequest[]> {
  const requestsRes = await query(
    'SELECT * FROM route_requests WHERE route_id = ? ORDER BY created_at DESC, id DESC',
    [routeId],
  )
  return mapRows<RouteRequest>(requestsRes.rows)
}
