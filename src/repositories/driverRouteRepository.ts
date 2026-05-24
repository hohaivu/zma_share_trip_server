import { query, withTransaction } from '../db/connection'
import { mapRows, normalizeUtc, parseNumeric, toCamelCase } from '../db/utils'
import { computeDepartureBlock } from '../domain/departureBlock'
import { loadRouteForWalletTx, reserveRouteFeeTx } from './walletRepository'
import * as planRepository from './planRepository'
import {
  filterTripsByScope,
  findAcceptedPlanMatchTx,
  findAcceptedRouteMatchTx,
  getReviewEligibility as getTripReviewEligibility,
  type TripListScope,
  withReviewEligibility,
} from './tripListRepository'
import { GroupOffer, Location, Plan, Route, RouteRequest } from '../types/entities'
import { CreateRoutePayload, UpdateRoutePayload, WithReviewEligibility } from '../types/payloads'

function generateId(prefix: string): string { return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}` }
function toSnakeCase(key: string): string { return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) }
function isTerminalTripStatus(status?: string | null): boolean { return status === 'completed' || status === 'canceled' }
function isActiveTripStatus(status?: string | null): boolean { return status === 'draft' || status === 'published' || status === 'matched' }
function mapRoute(row: Record<string, unknown>): Route { const route = toCamelCase<Route>(row); if (!route) throw new Error('Cannot map null row to Route'); route.tripPrice = parseNumeric(route.tripPrice); route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd); return route }
async function dynamicUpdate<T>(table: string, id: string, data: Record<string, unknown>, jsonFields: string[] = []): Promise<T | null> {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined)
  if (keys.length === 0) {
    const existing = await query(`SELECT * FROM ${table} WHERE id = ?`, [id])
    return toCamelCase<T>(existing.rows[0])
  }
  const setClauses = keys.map((key) => `${toSnakeCase(key)} = ?`)
  const timeFields = ['departureWindowStartDate', 'departureWindowEndDate']
  const vals = keys.map((k) => {
    const val = data[k]
    if (jsonFields.includes(k)) return JSON.stringify(val)
    if (timeFields.includes(k) && val) return new Date(val as string | number | Date).toISOString()
    return val
  })
  await query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ?`, [...vals, id])
  const result = await query(`SELECT * FROM ${table} WHERE id = ?`, [id])
  return toCamelCase<T>(result.rows[0])
}

const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE route_id = ? AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM route_requests WHERE route_id = ? AND status = 'accepted'
`

export async function checkRouteAvailability(
  executor: {
    query: (
      sql: string,
      params: unknown[],
    ) => Promise<{ rowCount: number | null }>
  },
  routeId: string,
): Promise<boolean> {
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId, routeId])
  return result.rowCount === 0
}

function extractWardFields(
  data: Record<string, unknown>,
  prefix: string,
  geoObj?: Location,
) {
  const wardId = (data[`${prefix}WardId`] as string) || geoObj?.ward_id || ''
  const provinceId =
    (data[`${prefix}ProvinceId`] as string) || geoObj?.province_id || ''
  return { wardId, provinceId }
}

export interface RouteWriteValues {
  carId: string
  origin: Location
  destination: Location
  originWardId: string
  originProvinceId: string
  destinationWardId: string
  destinationProvinceId: string
  departureWindowStartDate: string
  departureWindowEndDate: string
  tripPrice: number
  distanceMeters: number | null
  notes: string
}

export type PublishTransitionDecision =
  | { kind: 'idempotent'; route: Route }
  | {
      kind: 'proceed'
      nextValues: RouteWriteValues
      feeRequiredVnd: number
      reservationDescription?: string
    }

export async function createRoute(
  driverId: string,
  data: CreateRoutePayload,
): Promise<Route> {
  const fields = data as unknown as Record<string, unknown>
  const origin = extractWardFields(fields, 'origin', data.origin)
  const dest = extractWardFields(fields, 'destination', data.destination)
  const windowStart = normalizeUtc(data.departureWindowStartDate)
  const windowEnd = normalizeUtc(data.departureWindowEndDate)

  const res = await query(
    `
    INSERT INTO routes (
      id, driver_id, car_id, origin, destination,
      origin_ward_id, origin_province_id,
      destination_ward_id, destination_province_id,
      departure_window_start_date, departure_window_end_date,
      trip_price, distance_meters, notes, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    RETURNING *
  `,
    [
      generateId('route'),
      driverId,
      data.carId,
      JSON.stringify(data.origin),
      JSON.stringify(data.destination),
      origin.wardId,
      origin.provinceId,
      dest.wardId,
      dest.provinceId,
      windowStart,
      windowEnd,
      data.tripPrice,
      data.distanceMeters ?? null,
      data.notes || '',
      data.status || 'draft',
    ],
  )
  const route = mapRoute(res.rows[0])
  if (!route) throw new Error('Failed to create route')
  return route
}

async function shouldHideRequestForTerminalTrip(
  request:
    | Pick<RouteRequest, 'routeId' | 'planId'>
    | Pick<GroupOffer, 'routeId' | 'planId'>,
): Promise<boolean> {
  const route = await getRoute(request.routeId)
  if (isTerminalTripStatus(route?.status)) {
    return true
  }

  const plan = request.planId ? await planRepository.getPlan(request.planId) : null
  return isTerminalTripStatus(plan?.status)
}

export async function getReviewEligibility(
  tripId: string,
  viewerId: string,
  now: Date = new Date(),
) {
  return getTripReviewEligibility(tripId, viewerId, getRoute, planRepository.getPlan, now)
}

export async function getRoute(id: string): Promise<Route | null> {
  const result = await query('SELECT * FROM routes WHERE id = ?', [id])
  return result.rows[0] ? mapRoute(result.rows[0]) : null
}

export async function updateRoute(
  id: string,
  data: UpdateRoutePayload,
): Promise<Route | null> {
  const updated = await dynamicUpdate<Route>(
    'routes',
    id,
    data as unknown as Record<string, unknown>,
    ['origin', 'destination'],
  )
  return updated
    ? mapRoute(updated as unknown as Record<string, unknown>)
    : null
}

export async function runPublishTransition(
  id: string,
  decide: (route: Route) => PublishTransitionDecision,
): Promise<Route> {
  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, id, mapRoute)
    const decision = decide(route)
    if (decision.kind === 'idempotent') {
      return decision.route
    }

    const { nextValues, feeRequiredVnd, reservationDescription } = decision

    await reserveRouteFeeTx(tx, route, feeRequiredVnd, mapRoute, {
      description: reservationDescription,
    })

    await tx.query(
      `
      UPDATE routes
      SET car_id = ?,
          origin = ?,
          destination = ?,
          origin_ward_id = ?,
          origin_province_id = ?,
          destination_ward_id = ?,
          destination_province_id = ?,
          departure_window_start_date = ?,
          departure_window_end_date = ?,
          trip_price = ?,
          distance_meters = ?,
          notes = ?,
          status = 'published'
      WHERE id = ?
    `,
      [
        nextValues.carId,
        JSON.stringify(nextValues.origin),
        JSON.stringify(nextValues.destination),
        nextValues.originWardId,
        nextValues.originProvinceId,
        nextValues.destinationWardId,
        nextValues.destinationProvinceId,
        nextValues.departureWindowStartDate,
        nextValues.departureWindowEndDate,
        nextValues.tripPrice,
        nextValues.distanceMeters,
        nextValues.notes,
        id,
      ],
    )

    const updatedRoute = await tx.query('SELECT * FROM routes WHERE id = ?', [id])
    return mapRoute(updatedRoute.rows[0])
  })
}

export async function listAllRoutes(): Promise<Route[]> {
  const result = await query('SELECT * FROM routes')
  return result.rows.map(mapRoute)
}

export async function isRouteAvailable(routeId: string): Promise<boolean> {
  return checkRouteAvailability({ query }, routeId)
}

export async function listRoutesByDriver(
  driverId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Route>>> {
  const result = await query('SELECT * FROM routes WHERE driver_id = ?', [driverId])
  const routes = result.rows.map(mapRoute)
  const filtered = await filterTripsByScope(
    routes,
    scope,
    driverId,
    getRoute,
    planRepository.getPlan,
  )
  return Promise.all(
    filtered.map((route) =>
      withReviewEligibility(route, driverId, getRoute, planRepository.getPlan),
    ),
  )
}
