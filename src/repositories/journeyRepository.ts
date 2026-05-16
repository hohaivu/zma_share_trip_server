import { query } from '../db/connection'
import { mapRows, parseNumeric, toCamelCase } from '../db/utils'
import { GroupOffer, Route, RouteRequest, SavedLocation } from '../types/entities'
import { ReviewEligibility } from '../types/payloads'
import * as driverRouteRepository from './driverRouteRepository'
import * as planRepository from './planRepository'
import { getReviewEligibility as getTripReviewEligibility } from './tripListRepository'
import { findUserById } from './userRepository'

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
    const result = await query(`SELECT * FROM ${table} WHERE ${column} = $1`, [
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
  const requestsRes = await query('SELECT * FROM route_requests WHERE plan_id = $1 ORDER BY created_at DESC, id DESC', [planId])
  return mapRows<RouteRequest>(requestsRes.rows)
}

export async function listGroupOffersByPlan(planId: string): Promise<GroupOffer[]> {
  const offersRes = await query('SELECT * FROM group_offers WHERE plan_id = $1 ORDER BY created_at DESC, id DESC', [planId])
  return mapRows<GroupOffer>(offersRes.rows)
}

export const listRouteRequestsByRoute = listByColumn<RouteRequest>('route_requests', 'route_id')
export const listGroupOffersByRoute = listByColumn<GroupOffer>('group_offers', 'route_id')

export async function createSavedLocation(payload: { label: string; lat: number; lng: number }): Promise<SavedLocation> {
  const result = await query('SELECT COUNT(*) FROM saved_locations')
  if (parseInt(result.rows[0].count, 10) >= 10) throw new Error('Maximum 10 saved locations allowed')
  const insertRes = await query(`
    INSERT INTO saved_locations (id, label, lat, lng, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING *
  `, [generateId('savedloc'), payload.label, payload.lat, payload.lng])
  return parseLocationRow(insertRes.rows[0])
}

export async function listSavedLocations(): Promise<SavedLocation[]> {
  const result = await query('SELECT * FROM saved_locations')
  return result.rows.map(parseLocationRow)
}

export async function deleteSavedLocation(id: string): Promise<boolean> {
  const result = await query('DELETE FROM saved_locations WHERE id = $1 RETURNING id', [id])
  return result.rowCount !== null && result.rowCount > 0
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
}

export type JourneyRepository = typeof journeyRepository
