import { Kernel, Provider } from '../kernel'
import { requireAuth } from '../middleware/requireAuth'
import authRoute from '../routes/authRoutes'

export const authProvider: Provider = {
  name: 'auth',
  register(kernel: Kernel) {
    // POST /api/auth is public; every other /api route (incl. /api/drivers, /api/clients) needs a token.
    kernel.app.use('/api', authRoute)
    kernel.app.use('/api', requireAuth)
  },
}
