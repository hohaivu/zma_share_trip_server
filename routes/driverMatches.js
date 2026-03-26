const { Router } = require('express')
const matching = require('../matching')
const store = require('../store')

const router = Router()

// GET /api/driver/routes/:id/matched-demand-groups
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

// GET /api/driver/routes/:id/inbound-search-requests
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
