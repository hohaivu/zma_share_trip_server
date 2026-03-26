const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/routes — create a driver route
router.post('/routes', async (req, res) => {
  try {
    const { driverId, ...data } = req.body || {}
    if (!driverId) {
      return res.status(400).json({ message: 'driverId is required' })
    }

    const route = await store.createRoute(driverId, data)
    res.status(201).json(route)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/routes?driverId= — list by driver
router.get('/routes', async (req, res) => {
  try {
    const { driverId } = req.query
    if (!driverId) {
      return res.status(400).json({ message: 'driverId query is required' })
    }

    res.status(200).json(await store.listRoutesByDriver(driverId))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/routes/:id — detail
router.get('/routes/:id', async (req, res) => {
  try {
    const route = await store.getRoute(req.params.id)
    if (!route) {
      return res.status(404).json({ message: 'Route not found' })
    }

    res.status(200).json(route)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/routes/:id — update
router.put('/routes/:id', async (req, res) => {
  try {
    const route = await store.updateRoute(req.params.id, req.body || {})
    if (!route) {
      return res.status(404).json({ message: 'Route not found' })
    }

    res.status(200).json(route)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
