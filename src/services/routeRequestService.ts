import { RouteRequest } from '../types/entities'
import * as routeRequestRepository from '../repositories/routeRequestRepository'
import { emitNotification } from './notificationService'
import { assertUserRole } from './userService'

function isTerminalTripStatus(status?: string | null): boolean {
  return status === 'completed' || status === 'canceled'
}

async function shouldHideRequestForTerminalTrip(
  request: Pick<RouteRequest, 'routeId' | 'planId'>,
): Promise<boolean> {
  const route = await routeRequestRepository.getRoute(request.routeId)
  if (isTerminalTripStatus(route?.status)) return true

  const plan = request.planId ? await routeRequestRepository.getPlan(request.planId) : null
  return isTerminalTripStatus(plan?.status)
}

async function filterVisibleForActiveTrip<T extends Pick<RouteRequest, 'routeId' | 'planId'>>(
  items: T[],
): Promise<T[]> {
  const visibility = await Promise.all(items.map((item) => shouldHideRequestForTerminalTrip(item)))
  return items.filter((_, index) => !visibility[index])
}

export async function createRouteRequest(
  clientId: string,
  planId: string | null | undefined,
  routeId: string,
  note?: string,
): Promise<RouteRequest> {
  await assertUserRole(clientId, 'client')
  const { routeRequest, route } = await routeRequestRepository.createRouteRequest(
    clientId,
    planId,
    routeId,
    note,
  )

  emitNotification('route_request_received', route.driverId, {
    routeRequestId: routeRequest.id,
    clientId,
    routeId,
  })

  return routeRequest
}

export async function acceptRouteRequest(requestId: string): Promise<RouteRequest> {
  const routeRequest = await routeRequestRepository.acceptRouteRequest(requestId)

  emitNotification('route_request_accepted', routeRequest.clientId, {
    routeRequestId: requestId,
    routeId: routeRequest.routeId,
    driverId: routeRequest.driverId,
  })

  return routeRequest
}

export async function declineRouteRequest(requestId: string): Promise<RouteRequest> {
  const routeRequest = await routeRequestRepository.declineRouteRequest(requestId)

  emitNotification('route_request_declined', routeRequest.clientId, {
    routeRequestId: requestId,
  })

  return routeRequest
}

export async function cancelRouteRequest(requestId: string): Promise<RouteRequest> {
  const routeRequest = await routeRequestRepository.cancelRouteRequest(requestId)

  emitNotification('route_request_canceled', routeRequest.driverId, {
    routeRequestId: requestId,
  })

  return routeRequest
}

export async function listRouteRequestsByDriver(driverId: string, statuses?: string[]): Promise<RouteRequest[]> {
  await assertUserRole(driverId, 'driver')
  return filterVisibleForActiveTrip(await routeRequestRepository.listRouteRequestsByDriver(driverId, statuses))
}

export async function listRouteRequestsByClient(clientId: string, statuses?: string[]): Promise<RouteRequest[]> {
  await assertUserRole(clientId, 'client')
  return filterVisibleForActiveTrip(await routeRequestRepository.listRouteRequestsByClient(clientId, statuses))
}

export async function listRouteRequestsByRoute(routeId: string): Promise<RouteRequest[]> {
  return filterVisibleForActiveTrip(await routeRequestRepository.listRouteRequestsByRoute(routeId))
}

export const routeRequestService = {
  createRouteRequest,
  acceptRouteRequest,
  declineRouteRequest,
  cancelRouteRequest,
  listRouteRequestsByDriver,
  listRouteRequestsByClient,
  listRouteRequestsByRoute,
}
