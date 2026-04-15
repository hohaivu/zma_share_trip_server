import { NextFunction, Request, Response, Router } from 'express'

import { hasUsablePoint } from '../matching'
import * as store from '../store'
import { CreateRouteRequestBody, UpdateRoutePayload } from '../types/payloads'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

export function validateRouteLocations(
  method: string,
  body: Pick<UpdateRoutePayload, 'origin' | 'destination'> | undefined,
): string | null {
  const { origin, destination } = body || {}

  if (method === 'POST' && (!origin || !destination)) {
    return 'Validation Error: Origin and destination are required'
  }

  const locs = [origin, destination].filter(Boolean)
  for (const loc of locs) {
    if (!hasUsablePoint(loc)) {
      return 'Validation Error: Unresolved exact-point coordinates are not allowed'
    }
  }

  return null
}

function rejectUnresolvedCoordinates(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const validationError = validateRouteLocations(req.method, req.body)
  if (validationError) {
    return res.status(400).json({ message: validationError })
  }
  next()
}

// POST /api/driver/routes — create a driver route
router.post(
  '/routes',
  rejectUnresolvedCoordinates,
  asyncHandler(
    async (
      req: Request<Record<string, never>, unknown, CreateRouteRequestBody>,
      res: Response,
    ) => {
      const { driverId, ...data } = req.body
      requireParam(driverId, 'driverId is required')

      const route = await store.createRoute(driverId, data)
      res.status(201).json(route)
    },
  ),
)

// GET /api/driver/routes?driverId= — list by driver
router.get(
  '/routes',
  asyncHandler(async (req: Request, res: Response) => {
    const { driverId } = req.query
    requireParam(driverId as string, 'driverId query is required')

    res.json(await store.listRoutesByDriver(driverId as string))
  }),
)

// GET /api/driver/routes/:id — detail
router.get(
  '/routes/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const route = await store.getRoute(req.params.id as string)
    if (!route) {
      return res.status(404).json({ message: 'Route not found' })
    }

    res.json(route)
  }),
)

// PUT /api/driver/routes/:id — update
router.put(
  '/routes/:id',
  rejectUnresolvedCoordinates,
  asyncHandler(
    async (
      req: Request<{ id: string }, unknown, UpdateRoutePayload>,
      res: Response,
    ) => {
      const route =
        req.body.status === 'published'
          ? await store.publishRoute(req.params.id, req.body)
          : await store.updateRoute(req.params.id, req.body)
      if (!route) {
        return res.status(404).json({ message: 'Route not found' })
      }

      res.json(route)
    },
  ),
)

export default router
