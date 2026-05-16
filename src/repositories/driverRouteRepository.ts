import {
  createRoute as createRouteStore,
  getRoute as getRouteStore,
  listRoutesByDriver as listRoutesByDriverStore,
  publishRoute as publishRouteStore,
  type TripListScope,
  updateRoute as updateRouteStore,
} from '../store'
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
  return createRouteStore(driverId, data)
}

export async function listRoutesByDriver(
  driverId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Route>>> {
  return listRoutesByDriverStore(driverId, scope)
}

export async function getRoute(id: string): Promise<Route | null> {
  return getRouteStore(id)
}

export async function updateRoute(
  id: string,
  data: UpdateRoutePayload,
): Promise<Route | null> {
  return updateRouteStore(id, data)
}

export async function publishRoute(
  id: string,
  data: UpdateRoutePayload = {},
): Promise<Route> {
  return publishRouteStore(id, data)
}
