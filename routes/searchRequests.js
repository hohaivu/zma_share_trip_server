const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/search-requests — create search request
router.post('/search-requests', (req, res) => {
  const { clientId, tripPlanId, routeId, note } = req.body || {}
  if (!clientId || !tripPlanId || !routeId) {
    return res
      .status(400)
      .json({ message: 'clientId, tripPlanId, and routeId are required' })
  }

  try {
    const result = store.createSearchRequest(
      clientId,
      tripPlanId,
      routeId,
      note,
    )
    res.status(201).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// GET /api/search-requests?driverId= — driver inbox
// GET /api/search-requests?clientId= — client's sent requests
router.get('/search-requests', (req, res) => {
  const { driverId, clientId } = req.query

  if (driverId) {
    return res.status(200).json(store.listSearchRequestsByDriver(driverId))
  }

  if (clientId) {
    return res.status(200).json(store.listSearchRequestsByClient(clientId))
  }

  return res
    .status(400)
    .json({ message: 'driverId or clientId query is required' })
})

// POST /api/search-requests/:id/accept
router.post('/search-requests/:id/accept', (req, res) => {
  try {
    const result = store.acceptSearchRequest(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// POST /api/search-requests/:id/decline
router.post('/search-requests/:id/decline', (req, res) => {
  try {
    const result = store.declineSearchRequest(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

module.exports = router
