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
async function dynamicUpdate<T>(table: string, id: string, data: Record<string, unknown>, jsonFields: string[] = []): Promise<T | null> { const keys = Object.keys(data).filter((k) => data[k] !== undefined); if (keys.length === 0) { const existing = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]); return toCamelCase<T>(existing.rows[0]) } const setClauses = keys.map((key, idx) => `${toSnakeCase(key)} = $${idx + 2}`); const timeFields = ['departureDate','windowStart','windowEnd']; const vals = keys.map((k) => { const val = data[k]; if (jsonFields.includes(k)) return JSON.stringify(val); if (timeFields.includes(k) && val) return new Date(val as string | number | Date).toISOString(); return val }); const result = await query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`, [id, ...vals]); return toCamelCase<T>(result.rows[0]) }

const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE route_id = $1 AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM route_requests WHERE route_id = $1 AND status = 'accepted'
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
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId])
  return result.rowCount === 0
}

function extractWardFields(
  data: Record<string, unknown>,
  prefix: string,
  geoObj?: Location,
) {
  const wardId = (data[`${prefix}WardId`] as string) || geoObj?.wardId || ''
  const provinceId =
    (data[`${prefix}ProvinceId`] as string) || geoObj?.provinceId || ''
  const wardKey =
    (data[`${prefix}WardKey`] as string) ||
    (wardId && provinceId ? `${wardId}_${provinceId}` : '')
  return { wardId, provinceId, wardKey }
}

export interface RouteWriteValues {
  carId: string
  origin: Location
  destination: Location
  originWardKey: string
  originWardId: string
  originProvinceId: string
  destinationWardKey: string
  destinationWardId: string
  destinationProvinceId: string
  departureDate: string
  windowStart: string
  windowEnd: string
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
  const departureWindow = computeDepartureBlock(data.departureDate)

  const res = await query(
    `
    INSERT INTO routes (
      id, driver_id, car_id, origin, destination,
      origin_ward_key, origin_ward_id, origin_province_id,
      destination_ward_key, destination_ward_id, destination_province_id,
      departure_date, window_start, window_end,
      trip_price, distance_meters, notes, status, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
    RETURNING *
  `,
    [
      generateId('route'),
      driverId,
      data.carId,
      JSON.stringify(data.origin),
      JSON.stringify(data.destination),
      origin.wardKey,
      origin.wardId,
      origin.provinceId,
      dest.wardKey,
      dest.wardId,
      dest.provinceId,
      normalizeUtc(data.departureDate),
      data.windowStart ? normalizeUtc(data.windowStart) : departureWindow.start,
      data.windowEnd ? normalizeUtc(data.windowEnd) : departureWindow.end,
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
  const result = await query('SELECT * FROM routes WHERE id = $1', [id])
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

    const updatedRoute = await tx.query(
      `
      UPDATE routes
      SET car_id = $2,
          origin = $3,
          destination = $4,
          origin_ward_key = $5,
          origin_ward_id = $6,
          origin_province_id = $7,
          destination_ward_key = $8,
          destination_ward_id = $9,
          destination_province_id = $10,
          departure_date = $11,
          window_start = $12,
          window_end = $13,
          trip_price = $14,
          distance_meters = $15,
          notes = $16,
          status = 'published'
      WHERE id = $1
      RETURNING *
    `,
      [
        id,
        nextValues.carId,
        JSON.stringify(nextValues.origin),
        JSON.stringify(nextValues.destination),
        nextValues.originWardKey,
        nextValues.originWardId,
        nextValues.originProvinceId,
        nextValues.destinationWardKey,
        nextValues.destinationWardId,
        nextValues.destinationProvinceId,
        nextValues.departureDate,
        nextValues.windowStart,
        nextValues.windowEnd,
        nextValues.tripPrice,
        nextValues.distanceMeters,
        nextValues.notes,
      ],
    )

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
  const result = await query('SELECT * FROM routes WHERE driver_id = $1', [driverId])
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
