const { Router } = require('express')
const store = require('../store')

const router = Router()

/**
 * Shared helper: find an accepted match (search request or group offer) for an entity.
 * @param {Function} getSearchReqs - returns search requests to scan
 * @param {Function} getGroupOffers - returns group offers to scan
 * @param {string} planId - only match items with this planId (null = skip filter)
 * @param {Function} enrich - (accepted) => extra fields for the result
 */
async function findAccepted(getSearchReqs, getGroupOffers, planId, enrich) {
  const searchReqs = await getSearchReqs()
  const acceptedSearch = searchReqs.find(
    (r) =>
      r.status === 'accepted' && (planId === null || r.planId === planId),
  )
  if (acceptedSearch) {
    return { type: 'search_request', requestId: acceptedSearch.id, ...(await enrich(acceptedSearch)) }
  }

  const groupOffers = await getGroupOffers()
  const acceptedOffer = groupOffers.find(
    (o) =>
      o.status === 'accepted' && (planId === null || o.planId === planId),
  )
  if (acceptedOffer) {
    return { type: 'group_offer', offerId: acceptedOffer.id, ...(await enrich(acceptedOffer)) }
  }

  return null
}

async function findAcceptedForRoute(routeId) {
  const route = await store.getRoute(routeId)
  if (!route) return null

  return findAccepted(
    () => store.listSearchRequestsByRoute(routeId),
    () => store.listGroupOffersByRoute(routeId),
    null,
    async (accepted) => ({
      matchedUser: (await store.getUser(accepted.clientId)) || null,
      plan: (await store.getPlan(accepted.planId)) || null,
      tripPrice: accepted.tripPrice,
      status: accepted.status,
    }),
  )
}

async function findAcceptedForPlan(planId) {
  const tp = await store.getPlan(planId)
  if (!tp) return null

  return findAccepted(
    () => store.listSearchRequestsByClient(tp.clientId),
    () => store.listGroupOffersByClient(tp.clientId),
    planId,
    async (accepted) => ({
      matchedUser: (await store.getUser(accepted.driverId)) || null,
      route: (await store.getRoute(accepted.routeId)) || null,
      tripPrice: accepted.tripPrice,
      status: accepted.status,
    }),
  )
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
