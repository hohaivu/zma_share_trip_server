const { Router } = require('express')
const store = require('../store')

const router = Router()

function maskPlate(full) {
  if (!full || full.length < 4) return full || ''
  const prefix = full.slice(0, 4)
  const suffix = full.slice(-2)
  return `${prefix}***${suffix}`
}

router.post('/cars', async (req, res) => {
  try {
    const { ownerId, ownerName, ownerAvatar, ...data } = req.body || {}
    if (!ownerId) {
      return res.status(400).json({ message: 'ownerId is required' })
    }

    if (!data.plateNumberFull) {
      return res.status(400).json({ message: 'plateNumberFull is required' })
    }

    // Ensure the owner exists in the users table (upsert)
    await store.findOrCreateUser(ownerId, ownerName, ownerAvatar)

    const car = await store.createCar(ownerId, {
      ...data,
      plateNumberMasked: maskPlate(data.plateNumberFull),
      verificationStatus: data.verificationStatus || 'unverified',
      photos: data.photos || [],
    })

    res.status(201).json(car)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/cars', async (req, res) => {
  try {
    const { ownerId } = req.query
    if (!ownerId) {
      return res.status(400).json({ message: 'ownerId query is required' })
    }

    res.status(200).json(await store.listCarsByOwner(ownerId))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.put('/cars/:id', async (req, res) => {
  try {
    const updatePayload = { ...req.body }
    if (updatePayload.plateNumberFull) {
      updatePayload.plateNumberMasked = maskPlate(updatePayload.plateNumberFull)
    }

    const car = await store.updateCar(req.params.id, updatePayload)
    if (!car) {
      return res.status(404).json({ message: 'Car not found' })
    }

    res.status(200).json(car)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/cars/:id', async (req, res) => {
  try {
    const deleted = await store.deleteCar(req.params.id)
    if (!deleted) {
      return res.status(404).json({ message: 'Car not found' })
    }

    res.status(204).end()
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
