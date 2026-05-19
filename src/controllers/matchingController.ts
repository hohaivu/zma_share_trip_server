import { Request, Response } from 'express'

import * as matchingService from '../services/matchingService'
import { SearchRoutesCriteriaPayload } from '../types/payloads'
import { notFound, requireParam } from './helpers'

export async function searchRoutes(
  req: Request<Record<string, never>, unknown, SearchRoutesCriteriaPayload>,
  res: Response,
): Promise<void> {
  const criteria = req.body
  requireParam(criteria.clientId, 'clientId is required')
  requireParam(criteria.origin, 'origin is required')
  requireParam(criteria.destination, 'destination is required')
  requireParam(criteria.serviceDate, 'serviceDate is required')
  requireParam(criteria.departureBlockStart, 'departureBlockStart is required')
  requireParam(criteria.departureBlockEnd, 'departureBlockEnd is required')

  res.json(await matchingService.searchRoutes(criteria))
}

export async function listMatchedDemandGroups(
  req: Request,
  res: Response,
): Promise<void | Response> {
  const routeId = req.params.id as string
  if (!(await matchingService.routeExists(routeId))) {
    return notFound(res, 'Route not found')
  }

  res.json(await matchingService.listMatchedDemandGroups(routeId))
}

export async function listInboundRouteRequests(
  req: Request,
  res: Response,
): Promise<void | Response> {
  const routeId = req.params.id as string
  if (!(await matchingService.routeExists(routeId))) {
    return notFound(res, 'Route not found')
  }

  res.json(await matchingService.listPendingInboundRouteRequests(routeId))
}
