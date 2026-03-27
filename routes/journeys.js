const { Router } = require('express')
const store = require('../store')

const router = Router()

async function findAcceptedForRoute(routeId) {
  const route = await store.getRoute(routeId)
  if (!route) return null

  const searchReqs = await store.listSearchRequestsByRoute(routeId)
  const acceptedSearch = searchReqs.find((r) => r.status === 'accepted')
  if (acceptedSearch) {
    const client = await store.getUser(acceptedSearch.clientId)
    const tp = await store.getPlan(acceptedSearch.planId)
    return {
      type: 'search_request',
      requestId: acceptedSearch.id,
      matchedUser: client || null,
      plan: tp || null,
      tripPrice: acceptedSearch.tripPrice,
      status: acceptedSearch.status,
    }
  }

  const groupOffers = await store.listGroupOffersByRoute(routeId)
  const acceptedOffer = groupOffers.find((o) => o.status === 'accepted')
  if (acceptedOffer) {
    const client = await store.getUser(acceptedOffer.clientId)
    const tp = await store.getPlan(acceptedOffer.planId)
    return {
      type: 'group_offer',
      offerId: acceptedOffer.id,
      matchedUser: client || null,
      plan: tp || null,
      tripPrice: acceptedOffer.tripPrice,
      status: acceptedOffer.status,
    }
  }

  return null
}

async function findAcceptedForPlan(planId) {
  const tp = await store.getPlan(planId)
  if (!tp) return null

  const clientSearchReqs = await store.listSearchRequestsByClient(tp.clientId)
  const acceptedSearch = clientSearchReqs.find(
    (r) => r.planId === planId && r.status === 'accepted',
  )
  if (acceptedSearch) {
    const driver = await store.getUser(acceptedSearch.driverId)
    const route = await store.getRoute(acceptedSearch.routeId)
    return {
      type: 'search_request',
      requestId: acceptedSearch.id,
      matchedUser: driver || null,
      route: route || null,
      tripPrice: acceptedSearch.tripPrice,
      status: acceptedSearch.status,
    }
  }

  const clientOffers = await store.listGroupOffersByClient(tp.clientId)
  const acceptedOffer = clientOffers.find(
    (o) => o.planId === planId && o.status === 'accepted',
  )
  if (acceptedOffer) {
    const driver = await store.getUser(acceptedOffer.driverId)
    const route = await store.getRoute(acceptedOffer.routeId)
    return {
      type: 'group_offer',
      offerId: acceptedOffer.id,
      matchedUser: driver || null,
      route: route || null,
      tripPrice: acceptedOffer.tripPrice,
      status: acceptedOffer.status,
    }
  }

  return null
}

// GET /api/trips/:id/summary
router.get('/trips/:id/summary', async (req, res) => {
  try {
    const tripId = req.params.id
    const route = await store.getRoute(tripId)
    const plan = await store.getPlan(tripId)

    if (!route && !plan) {
      return res.status(404).json({ message: 'Trip not found' })
    }

    const entity = route || plan
    const counterpart = route
      ? await findAcceptedForRoute(tripId)
      : await findAcceptedForPlan(tripId)

    res.status(200).json({
      ...entity,
      accepted: counterpart || null,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

// POST /api/trips/:id/complete
router.post('/trips/:id/complete', async (req, res) => {
  try {
    const tripId = req.params.id
    const route = await store.getRoute(tripId)
    const plan = await store.getPlan(tripId)

    if (!route && !plan) {
      return res.status(404).json({ message: 'Trip not found' })
    }

    if (route) {
      const updated = await store.updateRoute(tripId, { status: 'completed' })
      return res.status(200).json(updated)
    }

    const updated = await store.updatePlan(tripId, { status: 'completed' })
    res.status(200).json(updated)
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Deprecated: saved locations

router.get('/trips/saved-locations', async (_req, res) => {
  try {
    res.status(200).json(await store.listSavedLocations())
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/trips/saved-locations', async (req, res) => {
  try {
    const location = await store.createSavedLocation(req.body || {})
    return res.status(201).json(location)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
})

router.delete('/trips/saved-locations/:id', async (req, res) => {
  try {
    const deleted = await store.deleteSavedLocation(req.params.id)
    if (!deleted) {
      return res.status(404).json({ message: 'Saved location not found' })
    }
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
