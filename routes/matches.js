const { Router } = require('express')
const matching = require('../matching')
const store = require('../store')

const router = Router()

// GET /api/routes/:id/matched-demand-groups (Task 4.3)
router.get('/routes/:id/matched-demand-groups', async (req, res) => {
  try {
    const route = await store.getRoute(req.params.id)
    if (!route) {
      return res.status(404).json({ message: 'Route not found' })
    }

    const results = await matching.computeMatchedDemandGroups(req.params.id)
    res.status(200).json(results)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET /api/trip-plans/:id/matching-routes (Task 4.5)
router.get('/trip-plans/:id/matching-routes', async (req, res) => {
  try {
    const results = await matching.computeMatchingRoutes(req.params.id)
    if (results === null) {
      return res.status(404).json({ message: 'Trip plan not found' })
    }
    res.status(200).json(results)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// GET /api/routes/:id/inbound-search-requests (Task 4.6)
router.get('/routes/:id/inbound-search-requests', async (req, res) => {
  try {
    const route = await store.getRoute(req.params.id)
    if (!route) {
      return res.status(404).json({ message: 'Route not found' })
    }

    const results = await store.listSearchRequestsByRoute(req.params.id)
    res.status(200).json(results)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
