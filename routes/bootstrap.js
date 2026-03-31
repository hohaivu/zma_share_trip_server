const { Router } = require('express')
const store = require('../store')
const { asyncHandler, requireParam } = require('./helpers')

const router = Router()

// POST /api/users/bootstrap — resolve or create app user from MAUID
router.post('/users/bootstrap', asyncHandler(async (req, res) => {
  const { mauid, displayName, avatarUrl } = req.body || {}
  requireParam(mauid, 'mauid is required')
  requireParam(displayName, 'displayName is required')
  if (avatarUrl === undefined) requireParam(null, 'avatarUrl is required')

  const { user, wasCreated } = await store.bootstrapUser(
    mauid,
    displayName,
    avatarUrl,
  )

  res.status(wasCreated ? 201 : 200).json(user)
}))

module.exports = router
