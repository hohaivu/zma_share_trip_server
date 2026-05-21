import { Router } from 'express'

import {
  driverRoutesController,
  validateRouteLocations,
} from '../controllers/driverRoutesController'
import { asyncHandler } from './helpers'

const router = Router()

export { validateRouteLocations }

// POST /api/drivers/routes/create — create a driver route
router.post(
  '/routes/create',
  driverRoutesController.rejectUnresolvedCoordinates('create'),
  asyncHandler(driverRoutesController.createRoute),
)

// POST /api/drivers/routes/list — list by driver
router.post('/routes/list', asyncHandler(driverRoutesController.listRoutes))

// POST /api/drivers/routes/get — detail
router.post('/routes/get', asyncHandler(driverRoutesController.getRoute))

// POST /api/drivers/routes/update — update
router.post(
  '/routes/update',
  driverRoutesController.rejectUnresolvedCoordinates('update'),
  asyncHandler(driverRoutesController.updateRoute),
)

export default router
