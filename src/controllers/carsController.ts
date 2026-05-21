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
  const { ownerId } = req.body || {}
  requireParam(ownerId, 'ownerId is required')

  res.json(await carService.listCarsByOwner(ownerId))
}

export async function getCar(req: Request, res: Response) {
  const { id } = req.body || {}
  requireParam(id, 'id is required')

  const car = await carService.getCarById(id)
  if (!car) {
    return notFound(res, 'Car not found')
  }

  res.json(car)
}

export async function updateCar(req: Request, res: Response) {
  const { id, ...patch } = req.body || {}
  requireParam(id, 'id is required')

  const car = await carService.updateCar(id, patch)
  if (!car) {
    return notFound(res, 'Car not found')
  }

  res.json(car)
}

export async function deleteCar(req: Request, res: Response) {
  const { id } = req.body || {}
  requireParam(id, 'id is required')

  const deleted = await carService.deleteCar(id)
  if (!deleted) {
    return notFound(res, 'Car not found')
  }

  res.status(204).end()
}
