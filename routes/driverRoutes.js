const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// POST /api/driver/routes — create a driver route
router.post('/routes', asyncHandler(async (req, res) => {
  const { driverId, ...data } = req.body || {}
  requireParam(driverId, 'driverId is required')

  const route = await store.createRoute(driverId, data)
  res.status(201).json(route)
}))

// GET /api/driver/routes?driverId= — list by driver
router.get('/routes', asyncHandler(async (req, res) => {
  const { driverId } = req.query
  requireParam(driverId, 'driverId query is required')

  res.json(await store.listRoutesByDriver(driverId))
}))

// GET /api/driver/routes/:id — detail
router.get('/routes/:id', asyncHandler(async (req, res) => {
  const route = await store.getRoute(req.params.id)
  if (!route) {
    return res.status(404).json({ message: 'Route not found' })
  }

  res.json(route)
}))

// PUT /api/driver/routes/:id — update
router.put('/routes/:id', asyncHandler(async (req, res) => {
  const route = await store.updateRoute(req.params.id, req.body || {})
  if (!route) {
    return res.status(404).json({ message: 'Route not found' })
  }

  res.json(route)
}))

module.exports = router
