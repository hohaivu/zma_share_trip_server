const { Router } = require('express')
const store = require('../store')

const router = Router()

// ─── Trip Summary & Complete (Phase 2) ─────────────────────────────────────────
// These operate on either a route or trip-plan, finding the accepted counterpart
// via group offers or search requests.

function findAcceptedForRoute(routeId) {
  const route = store.getRoute(routeId)
  if (!route) return null

  // Check search requests for this route
  const searchReqs = store.listSearchRequestsByRoute(routeId)
  const acceptedSearch = searchReqs.find((r) => r.status === 'accepted')
  if (acceptedSearch) {
    const client = store.getUser(acceptedSearch.clientId)
    const tp = store.getTripPlan(acceptedSearch.tripPlanId)
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
  const groupOffers = store.listGroupOffersByRoute(routeId)
  const acceptedOffer = groupOffers.find((o) => o.status === 'accepted')
  if (acceptedOffer) {
    const client = store.getUser(acceptedOffer.clientId)
    const tp = store.getTripPlan(acceptedOffer.tripPlanId)
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

function findAcceptedForTripPlan(tripPlanId) {
  const tp = store.getTripPlan(tripPlanId)
  if (!tp) return null

  // Check search requests where this trip plan is the source
  const clientSearchReqs = store.listSearchRequestsByClient(tp.clientId)
  const acceptedSearch = clientSearchReqs.find(
    (r) => r.tripPlanId === tripPlanId && r.status === 'accepted',
  )
  if (acceptedSearch) {
    const driver = store.getUser(acceptedSearch.driverId)
    const route = store.getRoute(acceptedSearch.routeId)
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
  const clientOffers = store.listGroupOffersByClient(tp.clientId)
  const acceptedOffer = clientOffers.find(
    (o) => o.tripPlanId === tripPlanId && o.status === 'accepted',
  )
  if (acceptedOffer) {
    const driver = store.getUser(acceptedOffer.driverId)
    const route = store.getRoute(acceptedOffer.routeId)
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
router.get('/trips/:id/summary', (req, res) => {
  const tripId = req.params.id
  const route = store.getRoute(tripId)
  const tripPlan = store.getTripPlan(tripId)

  if (!route && !tripPlan) {
    return res.status(404).json({ message: 'Trip not found' })
  }

  const entity = route || tripPlan
  const counterpart = route
    ? findAcceptedForRoute(tripId)
    : findAcceptedForTripPlan(tripId)

  res.status(200).json({
    ...entity,
    accepted: counterpart || null,
  })
})

// POST /api/trips/:id/complete
router.post('/trips/:id/complete', (req, res) => {
  const tripId = req.params.id
  const route = store.getRoute(tripId)
  const tripPlan = store.getTripPlan(tripId)

  if (!route && !tripPlan) {
    return res.status(404).json({ message: 'Trip not found' })
  }

  if (route) {
    const updated = store.updateRoute(tripId, { status: 'completed' })
    return res.status(200).json(updated)
  }

  const updated = store.updateTripPlan(tripId, { status: 'completed' })
  res.status(200).json(updated)
})

// ─── Deprecated: templates and saved locations (kept inert) ────────────────────

router.get('/trips/saved-locations', (_req, res) => {
  res.status(200).json(store.listSavedLocations())
})

router.post('/trips/saved-locations', (req, res) => {
  try {
    const location = store.createSavedLocation(req.body || {})
    return res.status(201).json(location)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
})

router.delete('/trips/saved-locations/:id', (req, res) => {
  const deleted = store.deleteSavedLocation(req.params.id)
  if (!deleted) {
    return res.status(404).json({ message: 'Saved location not found' })
  }
  res.status(204).end()
})

module.exports = router
