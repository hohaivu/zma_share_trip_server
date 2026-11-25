import express from 'express'

import { Kernel, Provider } from '../kernel'
import { requireAuth } from '../middleware/requireAuth'
import authRoute from '../routes/authRoutes'

export const authProvider: Provider = {
  name: 'auth',
  register(kernel: Kernel) {
    // POST /api/auth is public and parses its own body; every other /api route (incl. /api/drivers,
    // /api/clients) is authenticated before its body is parsed, so unauthenticated input never reaches the parser.
    kernel.app.use('/api', authRoute)
    kernel.app.use('/api', requireAuth)
    kernel.app.use('/api', express.json())
  },
}
