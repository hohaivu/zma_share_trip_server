const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/client/search-requests — create search request
router.post('/search-requests', async (req, res) => {
  const { clientId, planId, routeId, note } = req.body || {}
  if (!clientId || !planId || !routeId) {
    return res
      .status(400)
      .json({ message: 'clientId, planId, and routeId are required' })
  }

  try {
    const result = await store.createSearchRequest(
      clientId,
      planId,
      routeId,
      note,
    )
    res.status(201).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// GET /api/client/search-requests?clientId= — client's sent requests
router.get('/search-requests', async (req, res) => {
  try {
    const { clientId } = req.query
    if (!clientId) {
      return res.status(400).json({ message: 'clientId query is required' })
    }
    return res
      .status(200)
      .json(await store.listSearchRequestsByClient(clientId))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
