const { Router } = require('express')
const store = require('../store')

const router = Router()

// GET /api/client/group-offers?clientId= — client inbox
router.get('/group-offers', async (req, res) => {
  try {
    const { clientId } = req.query
    if (!clientId) {
      return res.status(400).json({ message: 'clientId query is required' })
    }

    res.status(200).json(await store.listGroupOffersByClient(clientId))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// POST /api/client/group-offers/:id/accept
router.post('/group-offers/:id/accept', async (req, res) => {
  try {
    const result = await store.acceptGroupOffer(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// POST /api/client/group-offers/:id/decline
router.post('/group-offers/:id/decline', async (req, res) => {
  try {
    const result = await store.declineGroupOffer(req.params.id)
    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

module.exports = router
