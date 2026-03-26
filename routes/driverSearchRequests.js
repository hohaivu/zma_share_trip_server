const { Router } = require('express')
const store = require('../store')

const router = Router()

// GET /api/driver/search-requests?driverId= — driver inbox
router.get('/search-requests', async (req, res) => {
  try {
    const { driverId } = req.query
    if (!driverId) {
      return res.status(400).json({ message: 'driverId query is required' })
    }
    return res
      .status(200)
      .json(await store.listSearchRequestsByDriver(driverId))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/driver/search-requests/:id/accept
router.post('/search-requests/:id/accept', async (req, res) => {
  try {
    const result = await store.acceptSearchRequest(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// POST /api/driver/search-requests/:id/decline
router.post('/search-requests/:id/decline', async (req, res) => {
  try {
    const result = await store.declineSearchRequest(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

module.exports = router
