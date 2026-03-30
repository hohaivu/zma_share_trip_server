const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// POST /api/users/:id/mode — save preferred mode
router.post('/users/:id/mode', asyncHandler(async (req, res) => {
  const { preferredMode } = req.body || {}
  requireParam(preferredMode, 'preferredMode is required')

  const result = await store.setUserMode(req.params.id, preferredMode)
  if (!result) {
    return res.status(404).json({ message: 'User not found' })
  }

  res.json(result)
}))

// GET /api/users/:id/mode — read preferred mode
router.get('/users/:id/mode', asyncHandler(async (req, res) => {
  const result = await store.getUserMode(req.params.id)
  if (!result) {
    return res.status(404).json({ message: 'User not found' })
  }

  res.json(result)
}))

module.exports = router
