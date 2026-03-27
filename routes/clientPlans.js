const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/trip-plans — create a trip plan
router.post('/trip-plans', async (req, res) => {
  try {
    const { clientId, clientName, clientAvatar, ...data } = req.body || {}
    if (!clientId) {
      return res.status(400).json({ message: 'clientId is required' })
    }

    // Ensure the client exists in the users table (upsert)
    await store.findOrCreateUser(clientId, clientName, clientAvatar)

    const plan = await store.createPlan(clientId, data)
    res.status(201).json(plan)
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

    res.status(200).json(await store.listPlansByClient(clientId))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/trip-plans/:id — detail
router.get('/trip-plans/:id', async (req, res) => {
  try {
    const plan = await store.getPlan(req.params.id)
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' })
    }

    res.status(200).json(plan)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/trip-plans/:id — update
router.put('/trip-plans/:id', async (req, res) => {
  try {
    const plan = await store.updatePlan(req.params.id, req.body || {})
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' })
    }

    res.status(200).json(plan)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
