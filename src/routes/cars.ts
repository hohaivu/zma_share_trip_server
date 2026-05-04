import { Request, Response, Router } from 'express'

import * as store from '../store'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

function maskPlate(full: string | undefined): string {
  if (!full || full.length < 4) return full || ''
  const prefix = full.slice(0, 4)
  const suffix = full.slice(-2)
  return `${prefix}***${suffix}`
}

router.post(
  '/cars',
  asyncHandler(async (req: Request, res: Response) => {
    const { ownerId, ...data } = req.body || {}
    requireParam(ownerId, 'ownerId is required')
    requireParam(data.plateNumberFull, 'plateNumberFull is required')

    const car = await store.createCar(ownerId, {
      ...data,
      plateNumberMasked: maskPlate(data.plateNumberFull),
      verificationStatus: data.verificationStatus || 'unverified',
      photos: data.photos || [],
    })

    res.status(201).json(car)
  }),
)

router.get(
  '/cars',
  asyncHandler(async (req: Request, res: Response) => {
    const { ownerId } = req.query
    requireParam(ownerId as string, 'ownerId query is required')

    res.json(await store.listCarsByOwner(ownerId as string))
  }),
)

router.get(
  '/cars/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const car = await store.getCarById(req.params.id as string)
    if (!car) {
      return res.status(404).json({ message: 'Car not found' })
    }

    res.json(car)
  }),
)

router.put(
  '/cars/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const updatePayload = { ...req.body }
    if (updatePayload.plateNumberFull) {
      updatePayload.plateNumberMasked = maskPlate(updatePayload.plateNumberFull)
    }

    const car = await store.updateCar(req.params.id as string, updatePayload)
    if (!car) {
      return res.status(404).json({ message: 'Car not found' })
    }

    res.json(car)
  }),
)

router.delete(
  '/cars/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await store.deleteCar(req.params.id as string)
    if (!deleted) {
      return res.status(404).json({ message: 'Car not found' })
    }

    res.status(204).end()
  }),
)

export default router
