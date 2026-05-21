import { Request, Response } from 'express'

import { routeRequestService } from '../services/routeRequestService'
import { requireParam } from '../routes/helpers'

export async function createRouteRequest(req: Request, res: Response): Promise<void> {
  const { clientId, planId, routeId, note } = req.body || {}
  requireParam(clientId, 'clientId is required')
  requireParam(routeId, 'routeId is required')

  const result = await routeRequestService.createRouteRequest(clientId, planId, routeId, note)
  res.status(201).json(result)
}

export async function listRouteRequestsByClient(req: Request, res: Response): Promise<void> {
  const { clientId } = req.body || {}
  requireParam(clientId, 'clientId is required')

  res.json(await routeRequestService.listRouteRequestsByClient(clientId))
}

export async function cancelRouteRequest(req: Request, res: Response): Promise<void> {
  const { id } = req.body || {}
  requireParam(id, 'id is required')

  res.json(await routeRequestService.cancelRouteRequest(id))
}

export async function listRouteRequestsByDriver(req: Request, res: Response): Promise<void> {
  const { driverId } = req.body || {}
  requireParam(driverId, 'driverId is required')

  res.json(await routeRequestService.listRouteRequestsByDriver(driverId))
}

export async function acceptRouteRequest(req: Request, res: Response): Promise<void> {
  const { id } = req.body || {}
  requireParam(id, 'id is required')

  res.json(await routeRequestService.acceptRouteRequest(id))
}

export async function declineRouteRequest(req: Request, res: Response): Promise<void> {
  const { id } = req.body || {}
  requireParam(id, 'id is required')

  res.json(await routeRequestService.declineRouteRequest(id))
}
