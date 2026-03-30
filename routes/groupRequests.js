const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// POST /api/driver/group-requests — create group request + fan-out
router.post('/group-requests', asyncHandler(async (req, res) => {
  const { driverId, routeId, demandGroupId, note } = req.body || {}
  requireParam(driverId, 'driverId is required')
  requireParam(routeId, 'routeId is required')
  requireParam(demandGroupId, 'demandGroupId is required')

  const result = await store.createGroupRequest(
    driverId,
    routeId,
    demandGroupId,
    note,
  )
  res.status(201).json(result)
}))

// GET /api/driver/group-requests?driverId= — driver's sent requests
router.get('/group-requests', asyncHandler(async (req, res) => {
  const { driverId } = req.query
  requireParam(driverId, 'driverId query is required')

  res.json(await store.listGroupRequestsByDriver(driverId))
}))

// POST /api/driver/group-requests/:id/cancel — cancel + close pending offers
router.post('/group-requests/:id/cancel', asyncHandler(async (req, res) => {
  const result = await store.cancelGroupRequest(req.params.id)
  res.json(result)
}))

module.exports = router
