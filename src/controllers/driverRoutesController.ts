import { NextFunction, Request, RequestHandler, Response } from 'express'

import { hasUsablePoint } from '../matching'
import * as routeService from '../services/driverRouteService'
import { errorBody, httpErrorCode } from '../shared/responseEnvelope'
import { CreateRouteRequestBody, UpdateRoutePayload } from '../types/payloads'
import { notFound, requireParam } from './helpers'

export interface DriverRoutesController {
  rejectUnresolvedCoordinates(mode: RouteLocationValidationMode): RequestHandler
  createRoute(
    req: Request<Record<string, never>, unknown, CreateRouteRequestBody>,
    res: Response,
  ): Promise<void>
  listRoutes(req: Request, res: Response): Promise<void>
  getRoute(req: Request, res: Response): Promise<void | Response>
  updateRoute(
    req: Request<Record<string, never>, unknown, UpdateRoutePayload & { id: string }>,
    res: Response,
  ): Promise<void | Response>
}

export type RouteLocationValidationMode = 'create' | 'update'

export function validateRouteLocations(
  mode: RouteLocationValidationMode,
  body: Pick<UpdateRoutePayload, 'origin' | 'destination'> | undefined,
): string | null {
  const { origin, destination } = body || {}

  if (mode === 'create' && (!origin || !destination)) {
    return 'Validation Error: Origin and destination are required'
  }

  if ((origin && !hasUsablePoint(origin)) || (destination && !hasUsablePoint(destination))) {
    return 'Validation Error: Unresolved exact-point coordinates are not allowed'
  }

  return null
}

export function createDriverRoutesController(): DriverRoutesController {
  return {
    rejectUnresolvedCoordinates(mode) {
      return (req: Request, res: Response, next: NextFunction) => {
        const validationError = validateRouteLocations(mode, req.body)
        if (validationError) {
          return res
            .status(400)
            .json(errorBody(httpErrorCode(400), validationError))
        }
        next()
      }
    },

    async createRoute(req, res) {
      const { driverId, ...data } = req.body || {}
      requireParam(driverId, 'driverId is required')

      const route = await routeService.createRoute(driverId, data)
      res.status(201).json(route)
    },

    async listRoutes(req, res) {
      const { driverId, scope } = req.body || {}
      requireParam(driverId, 'driverId is required')

      res.json(
        await routeService.listRoutesByDriver(
          driverId,
          scope === 'history' ? 'history' : 'active',
        ),
      )
    },

    async getRoute(req, res) {
      const { id } = req.body || {}
      requireParam(id, 'id is required')

      const route = await routeService.getRoute(id)
      if (!route) {
        return notFound(res, 'Route not found')
      }

      res.json(route)
    },

    async updateRoute(req, res) {
      const { id, ...data } = req.body || {}
      requireParam(id, 'id is required')

      const route =
        data.status === 'published'
          ? await routeService.publishRoute(id, data)
          : await routeService.updateRoute(id, data)
      if (!route) {
        return notFound(res, 'Route not found')
      }

      res.json(route)
    },
  }
}

export const driverRoutesController = createDriverRoutesController()
