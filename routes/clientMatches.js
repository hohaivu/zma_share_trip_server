const { Router } = require('express')
const matching = require('../matching')

const router = Router()

// GET /api/client/trip-plans/:id/matching-routes
router.get('/trip-plans/:id/matching-routes', async (req, res) => {
  try {
    const results = await matching.computeMatchingRoutes(req.params.id)
    if (results === null) {
      return res.status(404).json({ message: 'Trip plan not found' })
    }
    res.status(200).json(results)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

module.exports = router
