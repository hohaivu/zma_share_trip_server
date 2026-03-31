const { Router } = require('express')
const store = require('../store')
const { asyncHandler } = require('./helpers')

const router = Router()

// GET /api/driver/demand-groups/:id — group summary
router.get('/demand-groups/:id', asyncHandler(async (req, res) => {
  const group = await store.getDemandGroup(req.params.id)
  if (!group) {
    return res.status(404).json({ message: 'Demand group not found' })
  }

  res.json(group)
}))

// GET /api/driver/demand-groups/:id/members — member list
router.get('/demand-groups/:id/members', asyncHandler(async (req, res) => {
  const members = await store.getDemandGroupMembers(req.params.id)
  if (!members) {
    return res.status(404).json({ message: 'Demand group not found' })
  }
  res.json(members)
}))

module.exports = router
