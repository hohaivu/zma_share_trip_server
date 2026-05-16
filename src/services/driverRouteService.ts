import * as driverRouteRepository from '../repositories/driverRouteRepository'
import type { RouteWriteValues } from '../repositories/driverRouteRepository'
import { computeRouteFeeRequiredVnd } from '../repositories/walletRepository'
import { assertUserRole } from './userService'
import { TripListScope } from '../repositories/tripListRepository'
import { computeDepartureBlock } from '../domain/departureBlock'
import { HttpError } from '../http-error'
import { Route } from '../types/entities'
import {
  CreateRoutePayload,
  UpdateRoutePayload,
  WithReviewEligibility,
} from '../types/payloads'

function normalizeUtc(value: string | Date): string {
  return new Date(value).toISOString()
}

function formatLocalDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isPastServiceDate(serviceDate?: string | null): boolean {
  if (!serviceDate) return false
  return serviceDate < formatLocalDateValue(new Date())
}

function assertServiceDateIsNotPast(serviceDate?: string | null): void {
  if (isPastServiceDate(serviceDate)) {
    throw new HttpError(400, 'serviceDate cannot be in the past')
  }
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
): RouteWriteValues {
  const departureTime = data.departureTime
    ? normalizeUtc(data.departureTime)
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
      ? normalizeUtc(data.windowStart)
      : data.departureTime
        ? departureWindow.start
        : route.windowStart,
    windowEnd: data.windowEnd
      ? normalizeUtc(data.windowEnd)
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
  await assertUserRole(driverId, 'driver')
  assertServiceDateIsNotPast(data.serviceDate)
  return driverRouteRepository.createRoute(driverId, data)
}

export async function listRoutesByDriver(
  driverId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Route>>> {
  await assertUserRole(driverId, 'driver')
  return driverRouteRepository.listRoutesByDriver(driverId, scope)
}

export async function getRoute(id: string): Promise<Route | null> {
  return driverRouteRepository.getRoute(id)
}

export async function updateRoute(
  id: string,
  data: UpdateRoutePayload,
): Promise<Route | null> {
  const existing = await driverRouteRepository.getRoute(id)
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

  return driverRouteRepository.updateRoute(id, data)
}

export async function publishRoute(
  id: string,
  data: UpdateRoutePayload = {},
): Promise<Route> {
  assertServiceDateIsNotPast(data.serviceDate)

  return driverRouteRepository.runPublishTransition(id, (route) => {
    if (route.status === 'published') {
      return { kind: 'idempotent', route }
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
    return {
      kind: 'proceed',
      nextValues,
      feeRequiredVnd,
      reservationDescription: 'Route fee reserved on publish',
    }
  })
}
