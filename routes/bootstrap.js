const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/users/bootstrap — resolve or create app user from MAUID
router.post('/users/bootstrap', async (req, res) => {
  try {
    const { mauid, displayName, avatarUrl } = req.body || {}
    if (!mauid) {
      return res.status(400).json({ message: 'mauid is required' })
    }
    if (!displayName) {
      return res.status(400).json({ message: 'displayName is required' })
    }
    if (avatarUrl === undefined) {
      return res.status(400).json({ message: 'avatarUrl is required' })
    }

    const { user, wasCreated } = await store.bootstrapUser(
      mauid,
      displayName,
      avatarUrl,
    )

    res.status(wasCreated ? 201 : 200).json(user)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
