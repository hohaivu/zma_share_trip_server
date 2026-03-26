const { Router } = require('express')
const store = require('../store')

const router = Router()

// ─── Trip Summary & Complete (Phase 2) ─────────────────────────────────────────
// These operate on either a route or trip-plan, finding the accepted counterpart
// via group offers or search requests.

async function findAcceptedForRoute(routeId) {
  const route = await store.getRoute(routeId)
  if (!route) return null

  // Check search requests for this route
  const searchReqs = await store.listSearchRequestsByRoute(routeId)
  const acceptedSearch = searchReqs.find((r) => r.status === 'accepted')
  if (acceptedSearch) {
    const client = await store.getUser(acceptedSearch.clientId)
    const tp = await store.getTripPlan(acceptedSearch.tripPlanId)
    return {
      type: 'search_request',
      requestId: acceptedSearch.id,
      matchedUser: client || null,
      tripPlan: tp || null,
      tripPrice: acceptedSearch.tripPrice,
      status: acceptedSearch.status,
    }
  }

  // Check group offers for this route
  const groupOffers = await store.listGroupOffersByRoute(routeId)
  const acceptedOffer = groupOffers.find((o) => o.status === 'accepted')
  if (acceptedOffer) {
    const client = await store.getUser(acceptedOffer.clientId)
    const tp = await store.getTripPlan(acceptedOffer.tripPlanId)
    return {
      type: 'group_offer',
      offerId: acceptedOffer.id,
      matchedUser: client || null,
      tripPlan: tp || null,
      tripPrice: acceptedOffer.tripPrice,
      status: acceptedOffer.status,
    }
  }

  return null
}

async function findAcceptedForTripPlan(tripPlanId) {
  const tp = await store.getTripPlan(tripPlanId)
  if (!tp) return null

  // Check search requests where this trip plan is the source
  const clientSearchReqs = await store.listSearchRequestsByClient(tp.clientId)
  const acceptedSearch = clientSearchReqs.find(
    (r) => r.tripPlanId === tripPlanId && r.status === 'accepted',
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

  // Check group offers for this client
  const clientOffers = await store.listGroupOffersByClient(tp.clientId)
  const acceptedOffer = clientOffers.find(
    (o) => o.tripPlanId === tripPlanId && o.status === 'accepted',
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
    const tripPlan = await store.getTripPlan(tripId)

    if (!route && !tripPlan) {
      return res.status(404).json({ message: 'Trip not found' })
    }

    const entity = route || tripPlan
    const counterpart = route
      ? await findAcceptedForRoute(tripId)
      : await findAcceptedForTripPlan(tripId)

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
    const tripPlan = await store.getTripPlan(tripId)

    if (!route && !tripPlan) {
      return res.status(404).json({ message: 'Trip not found' })
    }

    if (route) {
      const updated = await store.updateRoute(tripId, { status: 'completed' })
      return res.status(200).json(updated)
    }

    const updated = await store.updateTripPlan(tripId, { status: 'completed' })
    res.status(200).json(updated)
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── Deprecated: templates and saved locations (kept inert) ────────────────────

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
