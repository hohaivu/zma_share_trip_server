const { Router } = require('express')
const store = require('../store')

const router = Router()

function maskPlate(full) {
  if (!full || full.length < 4) return full || ''
  const prefix = full.slice(0, 4)
  const suffix = full.slice(-2)
  return `${prefix}***${suffix}`
}

router.post('/cars', (req, res) => {
  const { ownerId, ...data } = req.body || {}
  if (!ownerId) {
    return res.status(400).json({ message: 'ownerId is required' })
  }

  if (!data.plateNumberFull) {
    return res.status(400).json({ message: 'plateNumberFull is required' })
  }

  const car = store.createCar(ownerId, {
    ...data,
    plateNumberMasked: maskPlate(data.plateNumberFull),
    verificationStatus: data.verificationStatus || 'unverified',
    photos: data.photos || [],
  })

  res.status(201).json(car)
})

router.get('/cars', (req, res) => {
  const { ownerId } = req.query
  if (!ownerId) {
    return res.status(400).json({ message: 'ownerId query is required' })
  }

  res.status(200).json(store.listCarsByOwner(ownerId))
})

router.put('/cars/:id', (req, res) => {
  const updatePayload = { ...req.body }
  if (updatePayload.plateNumberFull) {
    updatePayload.plateNumberMasked = maskPlate(updatePayload.plateNumberFull)
  }

  const car = store.updateCar(req.params.id, updatePayload)
  if (!car) {
    return res.status(404).json({ message: 'Car not found' })
  }

  res.status(200).json(car)
})

router.delete('/cars/:id', (req, res) => {
  const deleted = store.deleteCar(req.params.id)
  if (!deleted) {
    return res.status(404).json({ message: 'Car not found' })
  }

  res.status(204).end()
})

module.exports = router
