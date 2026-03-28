const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

function maskPlate(full) {
  if (!full || full.length < 4) return full || ''
  const prefix = full.slice(0, 4)
  const suffix = full.slice(-2)
  return `${prefix}***${suffix}`
}

router.post('/cars', asyncHandler(async (req, res) => {
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
}))

router.get('/cars', asyncHandler(async (req, res) => {
  const { ownerId } = req.query
  requireParam(ownerId, 'ownerId query is required')

  res.status(200).json(await store.listCarsByOwner(ownerId))
}))

router.put('/cars/:id', asyncHandler(async (req, res) => {
  const updatePayload = { ...req.body }
  if (updatePayload.plateNumberFull) {
    updatePayload.plateNumberMasked = maskPlate(updatePayload.plateNumberFull)
  }

  const car = await store.updateCar(req.params.id, updatePayload)
  if (!car) {
    return res.status(404).json({ message: 'Car not found' })
  }

  res.status(200).json(car)
}))

router.delete('/cars/:id', asyncHandler(async (req, res) => {
  const deleted = await store.deleteCar(req.params.id)
  if (!deleted) {
    return res.status(404).json({ message: 'Car not found' })
  }

  res.status(204).end()
}))

module.exports = router
