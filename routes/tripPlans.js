const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/trip-plans — create a trip plan
router.post('/trip-plans', (req, res) => {
  const { clientId, ...data } = req.body || {}
  if (!clientId) {
    return res.status(400).json({ message: 'clientId is required' })
  }

  const tripPlan = store.createTripPlan(clientId, data)
  res.status(201).json(tripPlan)
})

// GET /api/trip-plans?clientId= — list by client
router.get('/trip-plans', (req, res) => {
  const { clientId } = req.query
  if (!clientId) {
    return res.status(400).json({ message: 'clientId query is required' })
  }

  res.status(200).json(store.listTripPlansByClient(clientId))
})

// GET /api/trip-plans/:id — detail
router.get('/trip-plans/:id', (req, res) => {
  const tripPlan = store.getTripPlan(req.params.id)
  if (!tripPlan) {
    return res.status(404).json({ message: 'Trip plan not found' })
  }

  res.status(200).json(tripPlan)
})

// PUT /api/trip-plans/:id — update
router.put('/trip-plans/:id', (req, res) => {
  const tripPlan = store.updateTripPlan(req.params.id, req.body || {})
  if (!tripPlan) {
    return res.status(404).json({ message: 'Trip plan not found' })
  }

  res.status(200).json(tripPlan)
})

module.exports = router
