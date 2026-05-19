import { query, withTransaction } from '../db/connection'
import { mapRows, parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { GroupOffer, Plan, Route, RouteRequest, SavedLocation } from '../types/entities'
import { ReviewEligibility } from '../types/payloads'
import * as driverRouteRepository from './driverRouteRepository'
import * as planRepository from './planRepository'
import {
  findAcceptedPlanMatchTx,
  findAcceptedRouteMatchTx,
  getReviewEligibility as getTripReviewEligibility,
} from './tripListRepository'
import { findUserById } from './userRepository'
import {
  loadRouteForWalletTx,
  refundRouteFeeTx,
  releaseRouteFeeTx,
  type DbQueryExecutor,
} from './walletRepository'

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

export function mapRoute(row: Record<string, unknown>): Route {
  const route = toCamelCase<Route>(row)
  if (!route) throw new Error('Cannot map null row to Route')
  route.tripPrice = parseNumeric(route.tripPrice)
  route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd)
  return route
}

function parseLocationRow(row: Record<string, unknown>): SavedLocation {
  const loc = toCamelCase<SavedLocation>(row)
  if (!loc) throw new Error('Cannot map null row to SavedLocation')
  loc.lat = parseFloat(String(loc.lat))
  loc.lng = parseFloat(String(loc.lng))
  return loc
}

function listByColumn<T>(
  table: string,
  column: string,
  mapFn: (row: Record<string, unknown>) => T | null = toCamelCase,
) {
  return async (value: string | number): Promise<T[]> => {
    const result = await query(`SELECT * FROM ${table} WHERE ${column} = ?`, [
      value,
    ])
    return result.rows.map(mapFn).filter(Boolean) as T[]
  }
}

export async function getReviewEligibility(tripId: string, viewerId: string, now: Date = new Date()): Promise<ReviewEligibility> {
  return getTripReviewEligibility(tripId, viewerId, getRoute, getPlan, now)
}

export const getRoute = driverRouteRepository.getRoute
export const getPlan = planRepository.getPlan
export const getUser = findUserById

export async function listRouteRequestsByPlan(planId: string): Promise<RouteRequest[]> {
  const requestsRes = await query('SELECT * FROM route_requests WHERE plan_id = ? ORDER BY created_at DESC, id DESC', [planId])
  return mapRows<RouteRequest>(requestsRes.rows)
}

export async function listGroupOffersByPlan(planId: string): Promise<GroupOffer[]> {
  const offersRes = await query('SELECT * FROM group_offers WHERE plan_id = ? ORDER BY created_at DESC, id DESC', [planId])
  return mapRows<GroupOffer>(offersRes.rows)
}

export const listRouteRequestsByRoute = listByColumn<RouteRequest>('route_requests', 'route_id')
export const listGroupOffersByRoute = listByColumn<GroupOffer>('group_offers', 'route_id')

export async function createSavedLocation(payload: { label: string; lat: number; lng: number }): Promise<SavedLocation> {
  const result = await query('SELECT COUNT(*) AS count FROM saved_locations')
  if (parseInt(result.rows[0].count as string, 10) >= 10) throw new Error('Maximum 10 saved locations allowed')
  const insertRes = await query(`
    INSERT INTO saved_locations (id, label, lat, lng, created_at)
    VALUES (?, ?, ?, ?, NOW())
    RETURNING *
  `, [generateId('savedloc'), payload.label, payload.lat, payload.lng])
  return parseLocationRow(insertRes.rows[0])
}

export async function listSavedLocations(): Promise<SavedLocation[]> {
  const result = await query('SELECT * FROM saved_locations')
  return result.rows.map(parseLocationRow)
}

export async function deleteSavedLocation(id: string): Promise<boolean> {
  const result = await query('DELETE FROM saved_locations WHERE id = ? RETURNING id', [id])
  return result.rowCount !== null && result.rowCount > 0
}

type AcceptedJourneyMatch = Awaited<ReturnType<typeof findAcceptedRouteMatchTx>>

async function unwindRouteFeeOnMatchedCancel(executor: DbQueryExecutor, route: Route): Promise<Route> {
  switch (route.walletFeeStatus) {
    case 'charged':
      return refundRouteFeeTx(executor, route, mapRoute, { description: 'Route fee refunded on trip cancel' })
    case 'reserved':
      return releaseRouteFeeTx(executor, route, mapRoute, { description: 'Route fee released on trip cancel' })
    case 'refunded':
    case 'released':
    case 'none':
      return route
    default:
      throw new HttpError(409, `Cannot cancel matched route in fee state: ${route.walletFeeStatus}`)
  }
}

async function cancelAcceptedMatchTx(executor: DbQueryExecutor, accepted: AcceptedJourneyMatch): Promise<void> {
  if (!accepted) return
  if (accepted.kind === 'route_request') {
    await executor.query("UPDATE route_requests SET status = 'canceled' WHERE id = ?", [accepted.request.id])
  } else {
    await executor.query("UPDATE group_offers SET status = 'canceled' WHERE id = ?", [accepted.offer.id])
  }
}

async function cancelRouteTripTx(executor: DbQueryExecutor, route: Route): Promise<Route> {
  if (route.status === 'canceled') return route
  const accepted = await findAcceptedRouteMatchTx(executor, route.id)
  if (accepted) {
    route = await unwindRouteFeeOnMatchedCancel(executor, route)
    await cancelAcceptedMatchTx(executor, accepted)
  } else if (route.walletFeeStatus === 'reserved') {
    route = await releaseRouteFeeTx(executor, route, mapRoute, { description: 'Route fee released on route cancel' })
  } else if (route.walletFeeStatus === 'charged') {
    throw new HttpError(409, 'Cannot cancel an unmatched route after the fee has already been charged')
  }
  await executor.query("UPDATE routes SET status = 'canceled' WHERE id = ?", [route.id])
  const updatedRouteRes = await executor.query('SELECT * FROM routes WHERE id = ?', [route.id])
  return mapRoute(updatedRouteRes.rows[0])
}

async function cancelPlanTripTx(executor: DbQueryExecutor, plan: Plan): Promise<Plan> {
  if (plan.status === 'canceled') return plan
  const accepted = await findAcceptedPlanMatchTx(executor, plan)
  if (accepted) {
    const routeId = accepted.kind === 'route_request' ? accepted.request.routeId : accepted.offer.routeId
    const route = await loadRouteForWalletTx(executor, routeId, mapRoute)
    await unwindRouteFeeOnMatchedCancel(executor, route)
    await cancelAcceptedMatchTx(executor, accepted)
  }
  await executor.query("UPDATE plans SET status = 'canceled' WHERE id = ?", [plan.id])
  const updatedPlanRes = await executor.query('SELECT * FROM plans WHERE id = ?', [plan.id])
  const canceledPlan = toCamelCase<Plan>(updatedPlanRes.rows[0])
  if (!canceledPlan) throw new Error('Failed to cancel plan')
  return canceledPlan
}

export async function cancelTripTx(tripId: string): Promise<Route | Plan> {
  return withTransaction(async (tx) => {
    const routeRes = await tx.query('SELECT * FROM routes WHERE id = ? FOR UPDATE', [tripId])
    if (routeRes.rows[0]) return cancelRouteTripTx(tx, mapRoute(routeRes.rows[0]))
    const planRes = await tx.query('SELECT * FROM plans WHERE id = ? FOR UPDATE', [tripId])
    const plan = toCamelCase<Plan>(planRes.rows[0])
    if (plan) return cancelPlanTripTx(tx, plan)
    throw new HttpError(404, 'Trip not found')
  })
}

function acceptedPlanId(accepted: AcceptedJourneyMatch): string | null {
  if (!accepted) return null
  return accepted.kind === 'route_request' ? accepted.request.planId : accepted.offer.planId
}

function acceptedRouteId(accepted: AcceptedJourneyMatch): string | null {
  if (!accepted) return null
  return accepted.kind === 'route_request' ? accepted.request.routeId : accepted.offer.routeId
}

async function markEntityCompletedTx(
  executor: DbQueryExecutor,
  table: 'routes' | 'plans',
  id: string,
  completedAt: Date,
): Promise<void> {
  await executor.query(
    `UPDATE ${table} SET status = 'completed', completed_at = ? WHERE id = ?`,
    [completedAt, id],
  )
}

export async function completeTripTx(tripId: string): Promise<Route | Plan> {
  return withTransaction(async (tx) => {
    const completedAt = new Date()

    const routeRes = await tx.query('SELECT * FROM routes WHERE id = ? FOR UPDATE', [tripId])
    if (routeRes.rows[0]) {
      const route = mapRoute(routeRes.rows[0])
      const accepted = await findAcceptedRouteMatchTx(tx, route.id)
      await tx.query(
        "UPDATE routes SET status = 'completed', completed_at = ? WHERE id = ?",
        [completedAt, route.id],
      )
      const updatedRouteRes = await tx.query(
        'SELECT * FROM routes WHERE id = ?',
        [route.id],
      )
      const counterpartPlanId = acceptedPlanId(accepted)
      if (counterpartPlanId) {
        await markEntityCompletedTx(tx, 'plans', counterpartPlanId, completedAt)
      }
      return mapRoute(updatedRouteRes.rows[0])
    }

    const planRes = await tx.query('SELECT * FROM plans WHERE id = ? FOR UPDATE', [tripId])
    const plan = planRes.rows[0] ? toCamelCase<Plan>(planRes.rows[0]) : null
    if (plan) {
      const accepted = await findAcceptedPlanMatchTx(tx, plan)
      await tx.query(
        "UPDATE plans SET status = 'completed', completed_at = ? WHERE id = ?",
        [completedAt, plan.id],
      )
      const updatedPlanRes = await tx.query(
        'SELECT * FROM plans WHERE id = ?',
        [plan.id],
      )
      const counterpartRouteId = acceptedRouteId(accepted)
      if (counterpartRouteId) {
        await markEntityCompletedTx(tx, 'routes', counterpartRouteId, completedAt)
      }
      const updatedPlan = toCamelCase<Plan>(updatedPlanRes.rows[0])
      if (!updatedPlan) throw new Error('Failed to complete plan')
      return updatedPlan
    }

    throw new HttpError(404, 'Trip not found')
  })
}

export const journeyRepository = {
  getReviewEligibility,
  getRoute,
  getPlan,
  getUser,
  listRouteRequestsByRoute,
  listRouteRequestsByPlan,
  listGroupOffersByRoute,
  listGroupOffersByPlan,
  listSavedLocations,
  createSavedLocation,
  deleteSavedLocation,
  cancelTripTx,
  completeTripTx,
}

export type JourneyRepository = typeof journeyRepository
