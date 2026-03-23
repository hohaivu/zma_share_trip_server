const { Router } = require('express')
const store = require('../store')

const router = Router()

router.post('/trips/routes', (req, res) => {
  const { driverId, ...data } = req.body || {}
  if (!driverId) {
    return res.status(400).json({ message: 'driverId is required' })
  }

  const route = store.createRoute(driverId, data)
  res.status(201).json(route)
})

router.post('/trips/demands', (req, res) => {
  const { clientId, ...data } = req.body || {}
  if (!clientId) {
    return res.status(400).json({ message: 'clientId is required' })
  }

  const demand = store.createDemand(clientId, data)
  res.status(201).json(demand)
})

router.get('/trips/routes', (req, res) => {
  const { driverId } = req.query
  if (!driverId) {
    return res.status(400).json({ message: 'driverId query is required' })
  }

  res.status(200).json(store.listRoutesByDriver(driverId))
})

router.get('/trips/demands', (req, res) => {
  const { clientId } = req.query
  if (!clientId) {
    return res.status(400).json({ message: 'clientId query is required' })
  }

  res.status(200).json(store.listDemandsByClient(clientId))
})

router.put('/trips/routes/:id', (req, res) => {
  const route = store.updateRoute(req.params.id, req.body || {})
  if (!route) {
    return res.status(404).json({ message: 'Route not found' })
  }

  res.status(200).json(route)
})

router.put('/trips/demands/:id', (req, res) => {
  const demand = store.updateDemand(req.params.id, req.body || {})
  if (!demand) {
    return res.status(404).json({ message: 'Demand not found' })
  }

  res.status(200).json(demand)
})

router.post('/trips/templates', (req, res) => {
  const template = store.createTemplate(req.body || {})
  res.status(201).json(template)
})

router.get('/trips/templates', (_req, res) => {
  res.status(200).json(store.listTemplates())
})

router.delete('/trips/templates/:id', (req, res) => {
  const deleted = store.deleteTemplate(req.params.id)
  if (!deleted) {
    return res.status(404).json({ message: 'Template not found' })
  }

  res.status(204).end()
})

router.post('/trips/templates/:id/create', (req, res) => {
  const { driverId, carId } = req.body || {}
  if (!driverId || !carId) {
    return res.status(400).json({ message: 'driverId and carId are required' })
  }

  const route = store.createRouteFromTemplate(req.params.id, driverId, carId)
  if (!route) {
    return res.status(404).json({ message: 'Template not found' })
  }

  res.status(201).json(route)
})

router.post('/trips/saved-locations', (req, res) => {
  try {
    const location = store.createSavedLocation(req.body || {})
    return res.status(201).json(location)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
})

router.get('/trips/saved-locations', (_req, res) => {
  res.status(200).json(store.listSavedLocations())
})

router.delete('/trips/saved-locations/:id', (req, res) => {
  const deleted = store.deleteSavedLocation(req.params.id)
  if (!deleted) {
    return res.status(404).json({ message: 'Saved location not found' })
  }

  res.status(204).end()
})

router.get('/trips/:id', (req, res) => {
  const detail = store.getTripDetail(req.params.id)
  if (!detail) {
    return res.status(404).json({ message: 'Trip not found' })
  }

  res.status(200).json(detail)
})

router.post('/trips/:id/transition', (req, res) => {
  const { status } = req.body || {}
  if (!status) {
    return res.status(400).json({ message: 'status is required' })
  }

  try {
    const trip = store.transitionTripStatus(req.params.id, status)
    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' })
    }

    return res.status(200).json(trip)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
})

router.get('/trips', (req, res) => {
  const { userId, statusGroup } = req.query
  if (!userId || !statusGroup) {
    return res
      .status(400)
      .json({ message: 'userId and statusGroup query are required' })
  }

  try {
    const trips = store.listTripsByStatusGroup(userId, statusGroup)
    return res.status(200).json(trips)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
})

module.exports = router
