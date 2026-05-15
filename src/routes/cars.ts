import { Router } from 'express'

import * as carsController from '../controllers/carsController'
import { asyncHandler } from './helpers'

const router = Router()

router.post('/cars', asyncHandler(carsController.createCar))

router.get('/cars', asyncHandler(carsController.listCars))

router.get('/cars/:id', asyncHandler(carsController.getCar))

router.put('/cars/:id', asyncHandler(carsController.updateCar))

router.delete('/cars/:id', asyncHandler(carsController.deleteCar))

export default router
