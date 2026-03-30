const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// POST /api/client/trip-plans — create a plan
router.post('/trip-plans', asyncHandler(async (req, res) => {
  const { clientId, ...data } = req.body || {}
  requireParam(clientId, 'clientId is required')

  const plan = await store.createPlan(clientId, data)
  res.status(201).json(plan)
}))

// GET /api/client/trip-plans?clientId= — list by client
router.get('/trip-plans', asyncHandler(async (req, res) => {
  const { clientId } = req.query
  requireParam(clientId, 'clientId query is required')

  res.json(await store.listPlansByClient(clientId))
}))

// GET /api/client/trip-plans/:id — detail
router.get('/trip-plans/:id', asyncHandler(async (req, res) => {
  const plan = await store.getPlan(req.params.id)
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' })
  }

  res.json(plan)
}))

// PUT /api/client/trip-plans/:id — update
router.put('/trip-plans/:id', asyncHandler(async (req, res) => {
  const plan = await store.updatePlan(req.params.id, req.body || {})
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' })
  }

  res.json(plan)
}))

module.exports = router
