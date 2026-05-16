import { RouteRequest } from '../types/entities'
import * as routeRequestRepository from '../repositories/routeRequestRepository'
import { query } from '../db/connection'
import { HttpError } from '../http-error'

async function assertUserRole(userId: string, role: 'driver' | 'client'): Promise<void> {
  const result = await query('SELECT role FROM users WHERE id = $1', [userId])
  const user = result.rows[0] as { role?: string } | undefined
  if (!user) throw new HttpError(404, 'User not found')
  if (user.role !== role) throw new HttpError(403, `User must be a ${role} persona`)
}

function emitNotification(type: string, recipientId: string, data: Record<string, unknown>): void {
  const copy = type === 'route_request_accepted'
    ? {
        type: 'request_accepted',
        title: 'Request accepted',
        body: 'Your request was accepted.',
        targetRoute: '/journeys',
        deepLink: '/journeys',
        requestSource: 'route_request',
      }
    : type === 'route_request_declined'
      ? {
          type: 'request_declined',
          title: 'Request declined',
          body: 'Your request was declined.',
          targetRoute: '/offers',
          deepLink: '/offers',
          requestSource: 'route_request',
        }
      : type === 'route_request_canceled'
        ? {
            type: 'request_canceled',
            title: 'Request canceled',
            body: 'A request was canceled.',
            targetRoute: '/offers',
            deepLink: '/offers',
            requestSource: 'route_request',
          }
        : {
            type: 'request_received',
            title: 'New request received',
            body: 'You received a new direct request.',
            targetRoute: '/offers',
            deepLink: '/offers',
            requestSource: 'route_request',
          }

  void query(
    `
      INSERT INTO notifications (
        id, recipient_id, type, title, body, target_route, deep_link,
        request_source, metadata, read, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW())
    `,
    [
      `notif-${Date.now()}${Math.random().toString().slice(2, 6)}`,
      recipientId,
      copy.type,
      copy.title,
      copy.body,
      copy.targetRoute,
      copy.deepLink,
      copy.requestSource,
      JSON.stringify(data),
    ],
  ).catch((error) => {
    console.error('[emitNotification] failed to persist notification', error)
  })
}

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
  planId: string,
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

export async function listRouteRequestsByDriver(driverId: string): Promise<RouteRequest[]> {
  await assertUserRole(driverId, 'driver')
  return filterVisibleForActiveTrip(await routeRequestRepository.listRouteRequestsByDriver(driverId))
}

export async function listRouteRequestsByClient(clientId: string): Promise<RouteRequest[]> {
  await assertUserRole(clientId, 'client')
  return filterVisibleForActiveTrip(await routeRequestRepository.listRouteRequestsByClient(clientId))
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
