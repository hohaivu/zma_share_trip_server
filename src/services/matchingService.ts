import * as matching from '../matching'
import * as driverRouteService from './driverRouteService'
import * as routeRequestRepository from '../repositories/routeRequestRepository'
import { RouteRequest } from '../types/entities'
import {
  DemandGroupResult,
  MatchingRouteResult,
  SearchRoutesCriteriaPayload,
} from '../types/payloads'

const ACTIONABLE_ROUTE_REQUEST_STATUS = 'pending'

export async function searchRoutes(
  criteria: SearchRoutesCriteriaPayload,
): Promise<MatchingRouteResult[]> {
  return matching.computeMatchingRoutesFromCriteria(criteria)
}

export async function routeExists(routeId: string): Promise<boolean> {
  return (await driverRouteService.getRoute(routeId)) !== null
}

export async function listMatchedDemandGroups(
  routeId: string,
): Promise<DemandGroupResult[]> {
  return matching.computeMatchedDemandGroups(routeId)
}

export async function listPendingInboundRouteRequests(
  routeId: string,
): Promise<RouteRequest[]> {
  const results = await routeRequestRepository.listRouteRequestsByRoute(routeId)
  return results.filter(
    (request) => request.status === ACTIONABLE_ROUTE_REQUEST_STATUS,
  )
}
