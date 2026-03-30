const { Router } = require('express')
const matching = require('../matching')
const store = require('../store')
const { asyncHandler } = require('./helpers')

const router = Router()

// GET /api/driver/routes/:id/matched-demand-groups
router.get('/routes/:id/matched-demand-groups', asyncHandler(async (req, res) => {
  const route = await store.getRoute(req.params.id)
  if (!route) {
    return res.status(404).json({ message: 'Route not found' })
  }

  const results = await matching.computeMatchedDemandGroups(req.params.id)
  res.json(results)
}))

// GET /api/driver/routes/:id/inbound-search-requests
router.get('/routes/:id/inbound-search-requests', asyncHandler(async (req, res) => {
  const route = await store.getRoute(req.params.id)
  if (!route) {
    return res.status(404).json({ message: 'Route not found' })
  }

  const results = await store.listSearchRequestsByRoute(req.params.id)
  res.json(results)
}))

module.exports = router
