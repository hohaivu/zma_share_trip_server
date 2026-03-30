const { Router } = require('express')
const matching = require('../matching')
const { asyncHandler } = require('./helpers')

const router = Router()

// GET /api/client/trip-plans/:id/matching-routes
router.get('/trip-plans/:id/matching-routes', asyncHandler(async (req, res) => {
  const results = await matching.computeMatchingRoutes(req.params.id)
  if (results === null) {
    return res.status(404).json({ message: 'Trip plan not found' })
  }
  res.json(results)
}))

module.exports = router
