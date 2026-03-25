const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/group-requests — create group request + fan-out
router.post('/group-requests', (req, res) => {
  const { driverId, routeId, demandGroupId, note } = req.body || {}
  if (!driverId || !routeId || !demandGroupId) {
    return res
      .status(400)
      .json({ message: 'driverId, routeId, and demandGroupId are required' })
  }

  try {
    const result = store.createGroupRequest(
      driverId,
      routeId,
      demandGroupId,
      note,
    )
    res.status(201).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// GET /api/group-requests?driverId= — driver's sent requests
router.get('/group-requests', (req, res) => {
  const { driverId } = req.query
  if (!driverId) {
    return res.status(400).json({ message: 'driverId query is required' })
  }

  res.status(200).json(store.listGroupRequestsByDriver(driverId))
})

// POST /api/group-requests/:id/cancel — cancel + close pending offers
router.post('/group-requests/:id/cancel', (req, res) => {
  try {
    const result = store.cancelGroupRequest(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

module.exports = router
