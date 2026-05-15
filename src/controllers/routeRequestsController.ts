import { Request, Response } from 'express'

import { routeRequestService } from '../services/routeRequestService'
import { requireParam } from '../routes/helpers'

export async function createRouteRequest(req: Request, res: Response): Promise<void> {
  const { clientId, planId, routeId, note } = req.body || {}
  requireParam(clientId, 'clientId is required')
  requireParam(planId, 'planId is required')
  requireParam(routeId, 'routeId is required')

  const result = await routeRequestService.createRouteRequest(clientId, planId, routeId, note)
  res.status(201).json(result)
}

export async function listRouteRequestsByClient(req: Request, res: Response): Promise<void> {
  const { clientId } = req.query
  requireParam(clientId as string, 'clientId query is required')

  res.json(await routeRequestService.listRouteRequestsByClient(clientId as string))
}

export async function cancelRouteRequest(req: Request, res: Response): Promise<void> {
  res.json(await routeRequestService.cancelRouteRequest(req.params.id as string))
}

export async function listRouteRequestsByDriver(req: Request, res: Response): Promise<void> {
  const { driverId } = req.query
  requireParam(driverId as string, 'driverId query is required')

  res.json(await routeRequestService.listRouteRequestsByDriver(driverId as string))
}

export async function acceptRouteRequest(req: Request, res: Response): Promise<void> {
  res.json(await routeRequestService.acceptRouteRequest(req.params.id as string))
}

export async function declineRouteRequest(req: Request, res: Response): Promise<void> {
  res.json(await routeRequestService.declineRouteRequest(req.params.id as string))
}
