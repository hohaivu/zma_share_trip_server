import { query, withTransaction } from '../db/connection'
import { parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import {
  chargeRouteFeeTx,
  loadRouteForWalletTx,
  type DbQueryExecutor,
} from './walletRepository'
import { Plan, Route, RouteRequest } from '../types/entities'
import { assertRoutePlanEndsInFutureTx, expirePendingMatchesTx } from './requestLifecycleRepository'

function isPgUniqueViolation(e: unknown, constraint: string): boolean {
  const err = e as Record<string, unknown>
  return err?.code === '23505' && err?.constraint === constraint
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
  planId?: string,
  allowedGroupOfferId?: string,
  allowedRouteRequestId?: string,
): Promise<boolean> {
  const result = await executor.query(
    `
      SELECT 1 FROM group_offers WHERE (route_id = $1 OR plan_id = $2) AND status = 'accepted' AND ($3::text IS NULL OR id != $3)
      UNION ALL
      SELECT 1 FROM route_requests WHERE (route_id = $1 OR plan_id = $2) AND status = 'accepted' AND ($4::text IS NULL OR id != $4)
    `,
    [routeId, planId ?? null, allowedGroupOfferId ?? null, allowedRouteRequestId ?? null],
  )
  return result.rowCount === 0
}

export async function createRouteRequest(
  clientId: string,
  planId: string,
  routeId: string,
  note?: string,
): Promise<{ routeRequest: RouteRequest; route: Route }> {
  return withTransaction(async (tx) => {
    await expirePendingMatchesTx(tx)
    const existingRes = await tx.query(
      `SELECT * FROM route_requests WHERE client_id = $1 AND route_id = $2 AND status IN ('pending', 'accepted')`,
      [clientId, routeId],
    )
    if (existingRes.rows.length > 0) {
      const existingReq = toCamelCase<RouteRequest>(existingRes.rows[0])
      throw new HttpError<{ existingRequest: RouteRequest }>(
        409,
        'Duplicate active request already exists',
        { existingRequest: existingReq! },
      )
    }

    const tpRes = await tx.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [planId])
    const tp = toCamelCase<Plan>(tpRes.rows[0])
    if (!tp) throw new HttpError(400, 'Plan not found')
    if (tp.clientId !== clientId) {
      throw new HttpError(403, 'Plan does not belong to requesting client')
    }
    if (tp.status !== 'published') {
      throw new HttpError(409, `Cannot create route request for plan in status: ${tp.status}`)
    }

    const routeRes = await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [routeId])
    const route = mapRoute(routeRes.rows[0])
    if (!route) throw new HttpError(404, 'Route not found')
    if (route.status !== 'published') {
      throw new HttpError(409, `Cannot create route request for route in status: ${route.status}`)
    }
    await assertRoutePlanEndsInFutureTx(tx, routeId, planId, 'Route or plan has expired')

    if (!(await checkRouteAvailability(tx, routeId, planId))) {
      throw new HttpError(409, 'Route is not available — already has an accepted client')
    }

    try {
      const sreqRes = await tx.query(
        `
          INSERT INTO route_requests (id, client_id, plan_id, route_id, driver_id, trip_price, note, status, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          RETURNING *
        `,
        [generateId('sreq'), clientId, planId, routeId, route.driverId, route.tripPrice, note || '', 'pending'],
      )
      const routeRequest = toCamelCase<RouteRequest>(sreqRes.rows[0])
      if (!routeRequest) throw new Error('Failed to create search request')

      const reciprocalRes = await tx.query(
        `
          SELECT * FROM group_offers
          WHERE route_id = $1
            AND plan_id = $2
            AND client_id = $3
            AND status = 'pending'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
          FOR UPDATE
        `,
        [routeId, planId, clientId],
      )
      const matchedOffer = toCamelCase<{ id: string; groupRequestId?: string | null }>(
        reciprocalRes.rows[0],
      )

      if (!matchedOffer) return { routeRequest, route }

      if (route.status !== 'published') {
        throw new HttpError(409, `Cannot accept reciprocal group offer on route in status: ${route.status}`)
      }
      await assertRoutePlanEndsInFutureTx(tx, routeId, planId, 'Route or plan has expired')
      if (!(await checkRouteAvailability(tx, routeId, planId, matchedOffer.id, routeRequest.id))) {
        throw new HttpError(409, 'Route is no longer available — another client was accepted first')
      }

      const acceptedOfferRes = await tx.query(
        `
          UPDATE group_offers
          SET status = 'accepted', source_route_request_id = $1
          WHERE id = $2
            AND status = 'pending'
          RETURNING *
        `,
        [routeRequest.id, matchedOffer.id],
      )
      if (acceptedOfferRes.rowCount === 0) {
        throw new HttpError(409, 'Reciprocal group offer is no longer pending')
      }

      const acceptedRouteRequestRes = await tx.query(
        `
          UPDATE route_requests
          SET status = 'accepted', accepted_group_offer_id = $1
          WHERE id = $2
            AND status = 'pending'
          RETURNING *
        `,
        [matchedOffer.id, routeRequest.id],
      )
      const acceptedRouteRequest = toCamelCase<RouteRequest>(acceptedRouteRequestRes.rows[0])
      if (!acceptedRouteRequest) {
        throw new HttpError(409, 'Reciprocal route request is no longer pending')
      }

      const routeUpdateRes = await tx.query("UPDATE routes SET status = 'matched' WHERE id = $1 AND status = 'published'", [routeId])
      if (routeUpdateRes.rowCount === 0) throw new HttpError(409, 'Route is no longer published')
      const planUpdateRes = await tx.query("UPDATE plans SET status = 'matched' WHERE id = $1 AND status = 'published'", [
        planId,
      ])
      if (planUpdateRes.rowCount === 0) throw new HttpError(409, 'Plan is no longer published')
      await chargeRouteFeeTx(tx, route, mapRoute, {
        description: 'Route fee charged on reciprocal route request match',
      })
      if (matchedOffer.groupRequestId) {
        await tx.query(
          "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND id != $2 AND status = 'pending'",
          [matchedOffer.groupRequestId, matchedOffer.id],
        )
      }
      await tx.query(
        "UPDATE group_offers SET status = 'closed' WHERE (route_id = $1 OR plan_id = $3) AND id != $2 AND status = 'pending'",
        [routeId, matchedOffer.id, planId],
      )
      await tx.query(
        "UPDATE route_requests SET status = 'closed' WHERE (route_id = $1 OR plan_id = $3) AND id != $2 AND status = 'pending'",
        [routeId, routeRequest.id, planId],
      )
      if (matchedOffer.groupRequestId) {
        await tx.query(
          `
            UPDATE group_requests
            SET status = 'accepted', accepted_client_user_id = $1, accepted_plan_id = $2, client_id = $1
            WHERE id = $3
          `,
          [clientId, planId, matchedOffer.groupRequestId],
        )
      }

      return { routeRequest: acceptedRouteRequest, route }
    } catch (e: unknown) {
      if (isPgUniqueViolation(e, 'route_requests_active_client_route_idx')) {
        const raceRes = await tx.query(
          `SELECT * FROM route_requests WHERE client_id = $1 AND route_id = $2 AND status IN ('pending', 'accepted')`,
          [clientId, routeId],
        )
        const existingReqRace = toCamelCase<RouteRequest>(raceRes.rows[0])
        throw new HttpError<{ existingRequest: RouteRequest }>(
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
  const result = await query('SELECT * FROM routes WHERE id = $1', [routeId])
  return result.rows[0] ? mapRoute(result.rows[0]) : null
}

export async function getPlan(planId?: string): Promise<Plan | null> {
  if (!planId) return null
  const result = await query('SELECT * FROM plans WHERE id = $1', [planId])
  return toCamelCase<Plan>(result.rows[0])
}

export async function acceptRouteRequest(requestId: string): Promise<RouteRequest> {
  return withTransaction(async (tx) => {
    await expirePendingMatchesTx(tx)
    const sreqRes = await tx.query('SELECT * FROM route_requests WHERE id = $1 FOR UPDATE', [requestId])
    let sreq = toCamelCase<RouteRequest>(sreqRes.rows[0])
    if (!sreq) throw new HttpError(404, 'Search request not found')
    if (sreq.status === 'accepted') return sreq
    if (sreq.status !== 'pending') {
      throw new HttpError(409, `Cannot accept search request in status: ${sreq.status}`)
    }

    const route = await loadRouteForWalletTx(tx, sreq.routeId, mapRoute)
    const planRes = await tx.query('SELECT status FROM plans WHERE id = $1 FOR UPDATE', [sreq.planId])
    const planStatus = planRes.rows[0]?.status as string | undefined
    if (route.status !== 'published') {
      throw new HttpError(409, `Cannot accept search request on route in status: ${route.status}`)
    }
    if (planStatus !== 'published') {
      throw new HttpError(409, `Cannot accept search request on plan in status: ${planStatus}`)
    }
    await assertRoutePlanEndsInFutureTx(tx, sreq.routeId, sreq.planId, 'Route or plan has expired')
    if (!(await checkRouteAvailability(tx, sreq.routeId, sreq.planId))) {
      throw new HttpError(409, 'Route is no longer available — another client was accepted first')
    }

    const updatedRes = await tx.query("UPDATE route_requests SET status = 'accepted' WHERE id = $1 AND status = 'pending' RETURNING *", [requestId])
    sreq = toCamelCase<RouteRequest>(updatedRes.rows[0])
    if (!sreq) throw new Error('Failed to accept search request')

    const routeUpdateRes = await tx.query("UPDATE routes SET status = 'matched' WHERE id = $1 AND status = 'published'", [sreq.routeId])
    if (routeUpdateRes.rowCount === 0) throw new HttpError(409, 'Route is no longer published')
    if (sreq.planId) {
      const planUpdateRes = await tx.query("UPDATE plans SET status = 'matched' WHERE id = $1 AND status = 'published'", [sreq.planId])
      if (planUpdateRes.rowCount === 0) throw new HttpError(409, 'Plan is no longer published')
    }
    await chargeRouteFeeTx(tx, route, mapRoute, { description: 'Route fee charged on accepted search request' })
    await tx.query("UPDATE group_offers SET status = 'closed' WHERE (route_id = $1 OR plan_id = $2) AND status = 'pending'", [sreq.routeId, sreq.planId])
    await tx.query("UPDATE route_requests SET status = 'closed' WHERE (route_id = $1 OR plan_id = $3) AND id != $2 AND status = 'pending'", [sreq.routeId, requestId, sreq.planId])
    return sreq
  })
}

export async function declineRouteRequest(requestId: string): Promise<RouteRequest> {
  const sreqRes = await query('SELECT * FROM route_requests WHERE id = $1', [requestId])
  const sreq = toCamelCase<RouteRequest>(sreqRes.rows[0])
  if (!sreq) throw new Error('Search request not found')
  if (sreq.status !== 'pending') throw new Error(`Cannot decline search request in status: ${sreq.status}`)
  const updatedRes = await query("UPDATE route_requests SET status = 'declined' WHERE id = $1 RETURNING *", [requestId])
  const updated = toCamelCase<RouteRequest>(updatedRes.rows[0])
  if (!updated) throw new Error('Failed to decline search request')
  return updated
}

export async function cancelRouteRequest(requestId: string): Promise<RouteRequest> {
  const sreqRes = await query('SELECT * FROM route_requests WHERE id = $1', [requestId])
  const sreq = toCamelCase<RouteRequest>(sreqRes.rows[0])
  if (!sreq) throw new Error('Search request not found')
  if (sreq.status !== 'pending') {
    throw new HttpError(409, `Cannot cancel search request in status: ${sreq.status}`)
  }
  const updatedRes = await query("UPDATE route_requests SET status = 'canceled' WHERE id = $1 RETURNING *", [requestId])
  const updated = toCamelCase<RouteRequest>(updatedRes.rows[0])
  if (!updated) throw new Error('Failed to cancel search request')
  return updated
}

export async function listRouteRequestsByDriver(driverId: string): Promise<RouteRequest[]> {
  await expirePendingMatchesTx({ query })
  const requestsRes = await query(
    'SELECT * FROM route_requests WHERE driver_id = $1 ORDER BY created_at DESC, id DESC',
    [driverId],
  )
  return mapRows<RouteRequest>(requestsRes.rows)
}

export async function listRouteRequestsByClient(clientId: string): Promise<RouteRequest[]> {
  await expirePendingMatchesTx({ query })
  const requestsRes = await query(
    'SELECT * FROM route_requests WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
    [clientId],
  )
  return mapRows<RouteRequest>(requestsRes.rows)
}

export async function listRouteRequestsByRoute(routeId: string): Promise<RouteRequest[]> {
  await expirePendingMatchesTx({ query })
  const requestsRes = await query(
    'SELECT * FROM route_requests WHERE route_id = $1 ORDER BY created_at DESC, id DESC',
    [routeId],
  )
  return mapRows<RouteRequest>(requestsRes.rows)
}
