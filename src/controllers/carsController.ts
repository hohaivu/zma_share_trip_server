import { Request, Response } from 'express'

import { requireParam } from '../routes/helpers'
import { notFound } from './helpers'
import * as carService from '../services/carService'

export async function createCar(req: Request, res: Response) {
  const { ownerId, ...data } = req.body || {}
  requireParam(ownerId, 'ownerId is required')
  requireParam(data.plateNumberFull, 'plateNumberFull is required')

  const car = await carService.createCar(ownerId, data)
  res.status(201).json(car)
}

export async function listCars(req: Request, res: Response) {
  const { ownerId } = req.query
  requireParam(ownerId as string, 'ownerId query is required')

  res.json(await carService.listCarsByOwner(ownerId as string))
}

export async function getCar(req: Request, res: Response) {
  const car = await carService.getCarById(req.params.id as string)
  if (!car) {
    return notFound(res, 'Car not found')
  }

  res.json(car)
}

export async function updateCar(req: Request, res: Response) {
  const car = await carService.updateCar(req.params.id as string, req.body || {})
  if (!car) {
    return notFound(res, 'Car not found')
  }

  res.json(car)
}

export async function deleteCar(req: Request, res: Response) {
  const deleted = await carService.deleteCar(req.params.id as string)
  if (!deleted) {
    return notFound(res, 'Car not found')
  }

  res.status(204).end()
}
