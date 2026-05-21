import { Router } from 'express'

import * as carsController from '../controllers/carsController'
import { asyncHandler } from './helpers'

const router = Router()

router.post('/cars/list', asyncHandler(carsController.listCars))

router.post('/cars/get', asyncHandler(carsController.getCar))

router.post('/cars/create', asyncHandler(carsController.createCar))

router.post('/cars/update', asyncHandler(carsController.updateCar))

router.post('/cars/delete', asyncHandler(carsController.deleteCar))

export default router
