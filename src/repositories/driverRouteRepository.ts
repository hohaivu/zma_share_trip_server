import { query, withTransaction } from '../db/connection'
import { mapRows, normalizeUtc, parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { computeDepartureBlock } from '../domain/departureBlock'
import { computeRouteFeeRequiredVnd, loadRouteForWalletTx, reserveRouteFeeTx } from './walletRepository'
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
function formatLocalDateValue(date: Date): string { const year = date.getFullYear(); const month = `${date.getMonth() + 1}`.padStart(2, '0'); const day = `${date.getDate()}`.padStart(2, '0'); return `${year}-${month}-${day}` }
function isTerminalTripStatus(status?: string | null): boolean { return status === 'completed' || status === 'canceled' }
function isActiveTripStatus(status?: string | null): boolean { return status === 'draft' || status === 'published' || status === 'matched' }
function isPastServiceDate(serviceDate?: string | null): boolean { if (!serviceDate) return false; return serviceDate < formatLocalDateValue(new Date()) }
function assertServiceDateIsNotPast(serviceDate?: string | null): void { if (isPastServiceDate(serviceDate)) throw new HttpError(400, 'serviceDate cannot be in the past') }
function mapRoute(row: Record<string, unknown>): Route { const route = toCamelCase<Route>(row); if (!route) throw new Error('Cannot map null row to Route'); route.tripPrice = parseNumeric(route.tripPrice); route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd); return route }
async function dynamicUpdate<T>(table: string, id: string, data: Record<string, unknown>, jsonFields: string[] = []): Promise<T | null> { const keys = Object.keys(data).filter((k) => data[k] !== undefined); if (keys.length === 0) { const existing = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]); return toCamelCase<T>(existing.rows[0]) } const setClauses = keys.map((key, idx) => `${toSnakeCase(key)} = $${idx + 2}`); const timeFields = ['departureTime','windowStart','windowEnd','departureBlockStart','departureBlockEnd']; const vals = keys.map((k) => { const val = data[k]; if (jsonFields.includes(k)) return JSON.stringify(val); if (timeFields.includes(k) && val) return new Date(val as string | number | Date).toISOString(); return val }); const result = await query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`, [id, ...vals]); return toCamelCase<T>(result.rows[0]) }

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

const IMMUTABLE_PUBLISHED_ROUTE_FIELDS: Array<keyof UpdateRoutePayload> = [
  'origin',
  'destination',
  'originWardKey',
  'originWardId',
  'originProvinceId',
  'destinationWardKey',
  'destinationWardId',
  'destinationProvinceId',
  'serviceDate',
  'departureTime',
  'windowStart',
  'windowEnd',
  'distanceMeters',
]

function hasImmutablePublishedRouteFieldUpdate(
  data: UpdateRoutePayload,
): boolean {
  return IMMUTABLE_PUBLISHED_ROUTE_FIELDS.some(
    (field) => data[field] !== undefined,
  )
}

function buildRouteWriteValues(
  route: Route,
  data: UpdateRoutePayload,
) {
  const departureTime = data.departureTime
    ? (normalizeUtc(data.departureTime) as string)
    : route.departureTime
  const departureWindow = computeDepartureBlock(departureTime)

  return {
    carId: data.carId ?? route.carId,
    origin: data.origin ?? route.origin,
    destination: data.destination ?? route.destination,
    originWardKey: data.originWardKey ?? route.originWardKey,
    originWardId: data.originWardId ?? route.originWardId,
    originProvinceId: data.originProvinceId ?? route.originProvinceId,
    destinationWardKey: data.destinationWardKey ?? route.destinationWardKey,
    destinationWardId: data.destinationWardId ?? route.destinationWardId,
    destinationProvinceId:
      data.destinationProvinceId ?? route.destinationProvinceId,
    serviceDate: data.serviceDate ?? route.serviceDate,
    departureTime,
    windowStart: data.windowStart
      ? (normalizeUtc(data.windowStart) as string)
      : data.departureTime
        ? departureWindow.start
        : route.windowStart,
    windowEnd: data.windowEnd
      ? (normalizeUtc(data.windowEnd) as string)
      : data.departureTime
        ? departureWindow.end
        : route.windowEnd,
    tripPrice: data.tripPrice ?? route.tripPrice,
    distanceMeters: data.distanceMeters ?? route.distanceMeters ?? null,
    notes: data.notes ?? route.notes ?? '',
  }
}

export async function createRoute(
  driverId: string,
  data: CreateRoutePayload,
): Promise<Route> {
  assertServiceDateIsNotPast(data.serviceDate)

  const fields = data as unknown as Record<string, unknown>
  const origin = extractWardFields(fields, 'origin', data.origin)
  const dest = extractWardFields(fields, 'destination', data.destination)
  const departureWindow = computeDepartureBlock(data.departureTime)

  const res = await query(
    `
    INSERT INTO routes (
      id, driver_id, car_id, origin, destination, 
      origin_ward_key, origin_ward_id, origin_province_id,
      destination_ward_key, destination_ward_id, destination_province_id,
      service_date, departure_time, window_start, window_end, 
      trip_price, distance_meters, notes, status, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
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
      data.serviceDate,
      normalizeUtc(data.departureTime),
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
  const existing = await getRoute(id)
  if (!existing) return null

  assertServiceDateIsNotPast(data.serviceDate)

  if (
    existing.status === 'published' &&
    existing.walletFeeStatus &&
    existing.walletFeeStatus !== 'none' &&
    hasImmutablePublishedRouteFieldUpdate(data)
  ) {
    throw new HttpError(
      409,
      'Published fee-bearing route fields cannot be edited. Cancel and recreate the route instead.',
    )
  }

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

export async function publishRoute(
  id: string,
  data: UpdateRoutePayload = {},
): Promise<Route> {
  assertServiceDateIsNotPast(data.serviceDate)

  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, id, mapRoute)
    if (route.status === 'published') {
      return route
    }
    if (route.status !== 'draft') {
      throw new HttpError(
        409,
        `Cannot publish route in status: ${route.status}`,
      )
    }

    const nextValues = buildRouteWriteValues(route, data)
    const feeRequiredVnd = computeRouteFeeRequiredVnd(
      nextValues.distanceMeters ?? 0,
    )

    await reserveRouteFeeTx(tx, route, feeRequiredVnd, mapRoute, {
      description: 'Route fee reserved on publish',
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
          service_date = $11,
          departure_time = $12,
          window_start = $13,
          window_end = $14,
          trip_price = $15,
          distance_meters = $16,
          notes = $17,
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
        nextValues.serviceDate,
        nextValues.departureTime,
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
