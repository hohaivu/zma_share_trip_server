const { Router } = require('express')
const store = require('../store')

const router = Router()

// GET /api/group-offers?clientId= — client inbox
router.get('/group-offers', (req, res) => {
  const { clientId } = req.query
  if (!clientId) {
    return res.status(400).json({ message: 'clientId query is required' })
  }

  res.status(200).json(store.listGroupOffersByClient(clientId))
})

// POST /api/group-offers/:id/accept
router.post('/group-offers/:id/accept', (req, res) => {
  try {
    const result = store.acceptGroupOffer(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// POST /api/group-offers/:id/decline
router.post('/group-offers/:id/decline', (req, res) => {
  try {
    const result = store.declineGroupOffer(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

module.exports = router
