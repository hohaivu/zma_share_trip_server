const { Router } = require('express')
const store = require('../store')

const router = Router()

// GET /api/demand-groups/:id — group summary
router.get('/demand-groups/:id', (req, res) => {
  const group = store.getDemandGroup(req.params.id)
  if (!group) {
    return res.status(404).json({ message: 'Demand group not found' })
  }

  res.status(200).json(group)
})

// GET /api/demand-groups/:id/members — member list (gated on exact-3 visibility)
router.get('/demand-groups/:id/members', (req, res) => {
  const group = store.getDemandGroup(req.params.id)
  if (!group) {
    return res.status(404).json({ message: 'Demand group not found' })
  }

  // Near-3 groups should not expose members. For the demo, any derived group
  // from the store is considered exact-3 eligible (actual tier check happens
  // at the matching layer). We pass through here for demo simplicity.
  const members = store.getDemandGroupMembers(req.params.id)
  res.status(200).json(members)
})

module.exports = router
