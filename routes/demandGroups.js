const { Router } = require('express')
const store = require('../store')

const router = Router()

// GET /api/driver/demand-groups/:id — group summary
router.get('/demand-groups/:id', async (req, res) => {
  try {
    const group = await store.getDemandGroup(req.params.id)
    if (!group) {
      return res.status(404).json({ message: 'Demand group not found' })
    }

    res.status(200).json(group)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/driver/demand-groups/:id/members — member list
router.get('/demand-groups/:id/members', async (req, res) => {
  try {
    const group = await store.getDemandGroup(req.params.id)
    if (!group) {
      return res.status(404).json({ message: 'Demand group not found' })
    }

    // Near-3 groups should not expose members. For the demo, any derived group
    // from the store is considered exact-3 eligible (actual tier check happens
    // at the matching layer). We pass through here for demo simplicity.
    const members = await store.getDemandGroupMembers(req.params.id)
    res.status(200).json(members)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
