const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/routes — create a driver route
router.post('/routes', (req, res) => {
  const { driverId, ...data } = req.body || {}
  if (!driverId) {
    return res.status(400).json({ message: 'driverId is required' })
  }

  const route = store.createRoute(driverId, data)
  res.status(201).json(route)
})

// GET /api/routes?driverId= — list by driver
router.get('/routes', (req, res) => {
  const { driverId } = req.query
  if (!driverId) {
    return res.status(400).json({ message: 'driverId query is required' })
  }

  res.status(200).json(store.listRoutesByDriver(driverId))
})

// GET /api/routes/:id — detail
router.get('/routes/:id', (req, res) => {
  const route = store.getRoute(req.params.id)
  if (!route) {
    return res.status(404).json({ message: 'Route not found' })
  }

  res.status(200).json(route)
})

// PUT /api/routes/:id — update
router.put('/routes/:id', (req, res) => {
  const route = store.updateRoute(req.params.id, req.body || {})
  if (!route) {
    return res.status(404).json({ message: 'Route not found' })
  }

  res.status(200).json(route)
})

module.exports = router
