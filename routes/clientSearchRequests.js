const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// POST /api/client/search-requests — create search request
router.post('/search-requests', asyncHandler(async (req, res) => {
  const { clientId, planId, routeId, note } = req.body || {}
  requireParam(clientId, 'clientId is required')
  requireParam(planId, 'planId is required')
  requireParam(routeId, 'routeId is required')

  const result = await store.createSearchRequest(
    clientId,
    planId,
    routeId,
    note,
  )
  res.status(201).json(result)
}))

// GET /api/client/search-requests?clientId= — client's sent requests
router.get('/search-requests', asyncHandler(async (req, res) => {
  const { clientId } = req.query
  requireParam(clientId, 'clientId query is required')

  res.json(await store.listSearchRequestsByClient(clientId))
}))

module.exports = router
