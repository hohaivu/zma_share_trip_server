import { NextFunction, Request, Response } from 'express'

import { hasUsablePoint } from '../matching'
import * as routeService from '../services/driverRouteService'
import { CreateRouteRequestBody, UpdateRoutePayload } from '../types/payloads'
import { notFound, requireBodyOrQueryString, requireQueryString } from './helpers'

export interface DriverRoutesController {
  rejectUnresolvedCoordinates(req: Request, res: Response, next: NextFunction): void | Response
  createRoute(
    req: Request<Record<string, never>, unknown, CreateRouteRequestBody>,
    res: Response,
  ): Promise<void>
  listRoutes(req: Request, res: Response): Promise<void>
  getRoute(req: Request, res: Response): Promise<void | Response>
  updateRoute(
    req: Request<{ id: string }, unknown, UpdateRoutePayload>,
    res: Response,
  ): Promise<void | Response>
}

export function validateRouteLocations(
  method: string,
  body: Pick<UpdateRoutePayload, 'origin' | 'destination'> | undefined,
): string | null {
  const { origin, destination } = body || {}

  if (method === 'POST' && (!origin || !destination)) {
    return 'Validation Error: Origin and destination are required'
  }

  if ((origin && !hasUsablePoint(origin)) || (destination && !hasUsablePoint(destination))) {
    return 'Validation Error: Unresolved exact-point coordinates are not allowed'
  }

  return null
}

export function createDriverRoutesController(): DriverRoutesController {
  return {
    rejectUnresolvedCoordinates(req, res, next) {
      const validationError = validateRouteLocations(req.method, req.body)
      if (validationError) {
        return res.status(400).json({ message: validationError })
      }
      next()
    },

    async createRoute(req, res) {
      const { driverId, ...data } = req.body
      const driverIdValue = requireBodyOrQueryString(
        driverId,
        undefined,
        'driverId is required',
      )

      const route = await routeService.createRoute(driverIdValue, data)
      res.status(201).json(route)
    },

    async listRoutes(req, res) {
      const { driverId, scope } = req.query
      const driverIdValue = requireQueryString(driverId, 'driverId query is required')

      res.json(
        await routeService.listRoutesByDriver(
          driverIdValue,
          scope === 'history' ? 'history' : 'active',
        ),
      )
    },

    async getRoute(req, res) {
      const route = await routeService.getRoute(req.params.id as string)
      if (!route) {
        return notFound(res, 'Route not found')
      }

      res.json(route)
    },

    async updateRoute(req, res) {
      const route =
        req.body.status === 'published'
          ? await routeService.publishRoute(req.params.id, req.body)
          : await routeService.updateRoute(req.params.id, req.body)
      if (!route) {
        return notFound(res, 'Route not found')
      }

      res.json(route)
    },
  }
}

export const driverRoutesController = createDriverRoutesController()
