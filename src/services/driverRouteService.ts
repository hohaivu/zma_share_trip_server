import * as driverRouteRepository from '../repositories/driverRouteRepository'
import { TripListScope } from '../store'
import { Route } from '../types/entities'
import {
  CreateRoutePayload,
  UpdateRoutePayload,
  WithReviewEligibility,
} from '../types/payloads'

export async function createRoute(
  driverId: string,
  data: CreateRoutePayload,
): Promise<Route> {
  return driverRouteRepository.createRoute(driverId, data)
}

export async function listRoutesByDriver(
  driverId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Route>>> {
  return driverRouteRepository.listRoutesByDriver(driverId, scope)
}

export async function getRoute(id: string): Promise<Route | null> {
  return driverRouteRepository.getRoute(id)
}

export async function updateRoute(
  id: string,
  data: UpdateRoutePayload,
): Promise<Route | null> {
  return driverRouteRepository.updateRoute(id, data)
}

export async function publishRoute(
  id: string,
  data: UpdateRoutePayload = {},
): Promise<Route> {
  return driverRouteRepository.publishRoute(id, data)
}
