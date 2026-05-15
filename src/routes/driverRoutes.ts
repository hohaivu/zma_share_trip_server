import { Router } from 'express'

import {
  driverRoutesController,
  validateRouteLocations,
} from '../controllers/driverRoutesController'
import { asyncHandler } from './helpers'

const router = Router()

export { validateRouteLocations }

// POST /api/driver/routes — create a driver route
router.post(
  '/routes',
  driverRoutesController.rejectUnresolvedCoordinates,
  asyncHandler(driverRoutesController.createRoute),
)

// GET /api/driver/routes?driverId= — list by driver
router.get('/routes', asyncHandler(driverRoutesController.listRoutes))

// GET /api/driver/routes/:id — detail
router.get('/routes/:id', asyncHandler(driverRoutesController.getRoute))

// PUT /api/driver/routes/:id — update
router.put(
  '/routes/:id',
  driverRoutesController.rejectUnresolvedCoordinates,
  asyncHandler(driverRoutesController.updateRoute),
)

export default router
