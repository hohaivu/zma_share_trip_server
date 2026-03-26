const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/trip-plans — create a trip plan
router.post('/trip-plans', async (req, res) => {
  try {
    const { clientId, ...data } = req.body || {}
    if (!clientId) {
      return res.status(400).json({ message: 'clientId is required' })
    }

    const tripPlan = await store.createTripPlan(clientId, data)
    res.status(201).json(tripPlan)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/trip-plans?clientId= — list by client
router.get('/trip-plans', async (req, res) => {
  try {
    const { clientId } = req.query
    if (!clientId) {
      return res.status(400).json({ message: 'clientId query is required' })
    }

    res.status(200).json(await store.listTripPlansByClient(clientId))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/trip-plans/:id — detail
router.get('/trip-plans/:id', async (req, res) => {
  try {
    const tripPlan = await store.getTripPlan(req.params.id)
    if (!tripPlan) {
      return res.status(404).json({ message: 'Trip plan not found' })
    }

    res.status(200).json(tripPlan)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/trip-plans/:id — update
router.put('/trip-plans/:id', async (req, res) => {
  try {
    const tripPlan = await store.updateTripPlan(req.params.id, req.body || {})
    if (!tripPlan) {
      return res.status(404).json({ message: 'Trip plan not found' })
    }

    res.status(200).json(tripPlan)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
