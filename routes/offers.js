const { Router } = require('express')
const store = require('../store')

const router = Router()

const VALID_TRANSITIONS = {
  pending: ['accepted', 'declined', 'canceled', 'expired'],
  accepted: [],
  declined: [],
  canceled: [],
  expired: [],
}

function validateTransition(current, next) {
  const allowed = VALID_TRANSITIONS[current] || []
  if (!allowed.includes(next)) {
    throw new Error(`Invalid state transition: ${current} → ${next}`)
  }
}

router.post('/offers', (req, res) => {
  const { matchId, driverId, clientId, seatCount, note } = req.body || {}
  if (!matchId || !driverId || !clientId || !seatCount) {
    return res.status(400).json({
      message: 'matchId, driverId, clientId and seatCount are required',
    })
  }

  const match = store.getMatch(matchId)
  const route = match ? store.getRoute(match.driverRouteId) : null

  const offer = store.createOffer({
    matchId,
    driverId,
    clientId,
    seatCount,
    note,
    pricePerSeat: route ? route.pricePerSeat : undefined,
  })

  res.status(201).json(offer)
})

router.post('/offers/:id/accept', (req, res) => {
  const offer = store.getOffer(req.params.id)
  if (!offer) {
    return res.status(404).json({ message: 'Offer not found' })
  }

  try {
    validateTransition(offer.status, 'accepted')
    const updated = store.updateOffer(offer.id, { status: 'accepted' })
    return res.status(200).json(updated)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
})

router.post('/offers/:id/decline', (req, res) => {
  const offer = store.getOffer(req.params.id)
  if (!offer) {
    return res.status(404).json({ message: 'Offer not found' })
  }

  try {
    validateTransition(offer.status, 'declined')
    const updated = store.updateOffer(offer.id, { status: 'declined' })
    return res.status(200).json(updated)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
})

router.post('/offers/:id/cancel', (req, res) => {
  const offer = store.getOffer(req.params.id)
  if (!offer) {
    return res.status(404).json({ message: 'Offer not found' })
  }

  try {
    validateTransition(offer.status, 'canceled')
    const updated = store.updateOffer(offer.id, { status: 'canceled' })
    return res.status(200).json(updated)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
})

router.get('/offers', (req, res) => {
  const { driverId, clientId } = req.query

  if (driverId) {
    return res.status(200).json(store.listOffersByDriver(driverId))
  }

  if (clientId) {
    return res.status(200).json(store.listOffersByClient(clientId))
  }

  return res
    .status(400)
    .json({ message: 'driverId or clientId query is required' })
})

module.exports = router
