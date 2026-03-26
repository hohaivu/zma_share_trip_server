const { Router } = require('express')
const store = require('../store')

const router = Router()

// POST /api/users/:id/mode — save preferred mode
router.post('/users/:id/mode', async (req, res) => {
  try {
    const { preferredMode } = req.body || {}
    if (!preferredMode) {
      return res.status(400).json({ message: 'preferredMode is required' })
    }

    const result = await store.setUserMode(req.params.id, preferredMode)
    if (!result) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.status(200).json(result)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/users/:id/mode — read preferred mode
router.get('/users/:id/mode', async (req, res) => {
  try {
    const result = await store.getUserMode(req.params.id)
    if (!result) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.status(200).json(result)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
