const { Router } = require('express')
const matching = require('../matching')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// GET /api/client/trip-plans/:id/matching-routes
router.get('/trip-plans/:id/matching-routes', asyncHandler(async (req, res) => {
  const results = await matching.computeMatchingRoutes(req.params.id)
  if (results === null) {
    return res.status(404).json({ message: 'Trip plan not found' })
  }
  res.json(results)
}))

// POST /api/client/search-routes
router.post('/search-routes', asyncHandler(async (req, res) => {
  const criteria = req.body || {}
  requireParam(criteria.clientId, 'clientId is required')
  requireParam(criteria.pickup, 'pickup is required')
  requireParam(criteria.dropoff, 'dropoff is required')
  requireParam(criteria.serviceDate, 'serviceDate is required')
  requireParam(criteria.departureBlockStart, 'departureBlockStart is required')
  requireParam(criteria.departureBlockEnd, 'departureBlockEnd is required')

  const results = await matching.computeMatchingRoutesFromCriteria(criteria)
  res.json(results)
}))

module.exports = router
