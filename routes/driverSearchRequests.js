const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// GET /api/driver/search-requests?driverId= — driver inbox
router.get('/search-requests', asyncHandler(async (req, res) => {
  const { driverId } = req.query
  requireParam(driverId, 'driverId query is required')

  res.json(await store.listSearchRequestsByDriver(driverId))
}))

// POST /api/driver/search-requests/:id/accept
router.post('/search-requests/:id/accept', asyncHandler(async (req, res) => {
  const result = await store.acceptSearchRequest(req.params.id)
  res.json(result)
}))

// POST /api/driver/search-requests/:id/decline
router.post('/search-requests/:id/decline', asyncHandler(async (req, res) => {
  const result = await store.declineSearchRequest(req.params.id)
  res.json(result)
}))

module.exports = router
