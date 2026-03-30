const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// GET /api/client/group-offers?clientId= — client inbox
router.get('/group-offers', asyncHandler(async (req, res) => {
  const { clientId } = req.query
  requireParam(clientId, 'clientId query is required')

  res.json(await store.listGroupOffersByClient(clientId))
}))

// POST /api/client/group-offers/:id/accept
router.post('/group-offers/:id/accept', asyncHandler(async (req, res) => {
  const result = await store.acceptGroupOffer(req.params.id)
  res.json(result)
}))

// POST /api/client/group-offers/:id/decline
router.post('/group-offers/:id/decline', asyncHandler(async (req, res) => {
  const result = await store.declineGroupOffer(req.params.id)
  res.json(result)
}))

module.exports = router
