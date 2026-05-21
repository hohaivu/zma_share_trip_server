import { Request, Response } from 'express'

import * as demandGroupService from '../services/demandGroupService'
import * as matchingService from '../services/matchingService'
import { SearchRoutesCriteriaPayload } from '../types/payloads'
import { notFound, requireParam } from './helpers'

export async function searchRoutes(
  req: Request<Record<string, never>, unknown, SearchRoutesCriteriaPayload>,
  res: Response,
): Promise<void> {
  const criteria = req.body || {}
  requireParam(criteria.clientId, 'clientId is required')
  requireParam(criteria.origin, 'origin is required')
  requireParam(criteria.destination, 'destination is required')
  requireParam(criteria.departureWindowStartDate, 'departureWindowStartDate is required')
  requireParam(criteria.departureWindowEndDate, 'departureWindowEndDate is required')

  res.json(await matchingService.searchRoutes(criteria))
}

export async function listMatchedDemandGroups(
  req: Request,
  res: Response,
): Promise<void | Response> {
  const { routeId } = req.body || {}
  requireParam(routeId, 'routeId is required')
  if (!(await matchingService.routeExists(routeId))) {
    return notFound(res, 'Route not found')
  }

  res.json(await matchingService.listMatchedDemandGroups(routeId))
}

export async function listInboundRouteRequests(
  req: Request,
  res: Response,
): Promise<void | Response> {
  const { routeId } = req.body || {}
  requireParam(routeId, 'routeId is required')
  if (!(await matchingService.routeExists(routeId))) {
    return notFound(res, 'Route not found')
  }

  res.json(await matchingService.listPendingInboundRouteRequests(routeId))
}

export async function getDemandGroup(
  req: Request,
  res: Response,
): Promise<void | Response> {
  const { id, demandGroupId } = req.body || {}
  const groupId = id || demandGroupId
  requireParam(groupId, 'id is required')
  const group = await demandGroupService.getDemandGroup(groupId)
  if (!group) return notFound(res, 'Demand group not found')
  res.json(group)
}

export async function listDemandGroupMembers(
  req: Request,
  res: Response,
): Promise<void | Response> {
  const { id, demandGroupId } = req.body || {}
  const groupId = id || demandGroupId
  requireParam(groupId, 'id is required')
  const members = await demandGroupService.listDemandGroupMembers(groupId)
  if (!members) return notFound(res, 'Demand group not found')
  res.json(members)
}
