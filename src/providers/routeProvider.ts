import express from 'express'

import { Kernel, Provider } from '../kernel'
import { requireAuth } from '../middleware/requireAuth'
import authRoute from '../routes/authRoutes'
import bootstrapRoute from '../routes/bootstrap'
import carsRoute from '../routes/cars'
import clientMatchesRoute from '../routes/clientMatches'
import clientInboxRoute from '../routes/clientInbox'
import clientPlansRoute from '../routes/clientPlans'
import clientRouteRequestsRoute from '../routes/clientRouteRequests'
import demandGroupsRoute from '../routes/demandGroups'
import driverMatchesRoute from '../routes/driverMatches'
import driverRouteRequestsRoute from '../routes/driverRouteRequests'
import driverRoutesRoute from '../routes/driverRoutes'
import driverWalletRoute from '../routes/driverWallet'
import groupOffersRoute from '../routes/groupOffers'
import groupRequestsRoute from '../routes/groupRequests'
import journeysRoute from '../routes/journeys'
import usersRoute from '../routes/users'
import vnmapRoutesRoute from '../routes/vnmapRoutes'

const routeGroups: Array<[string, express.Router[]]> = [
  ['/api', [vnmapRoutesRoute, journeysRoute, usersRoute, bootstrapRoute]],
  ['/api/drivers', [carsRoute, driverRoutesRoute, driverWalletRoute, driverMatchesRoute, demandGroupsRoute, groupRequestsRoute, driverRouteRequestsRoute]],
  ['/api/clients', [clientPlansRoute, clientMatchesRoute, clientInboxRoute, groupOffersRoute, clientRouteRequestsRoute]],
]

export const routeProvider: Provider = {
  name: 'routes',
  register(kernel: Kernel) {
    // POST /api/auth is public; everything else under /api (incl. /api/drivers, /api/clients) needs a token.
    kernel.app.use('/api', authRoute)
    kernel.app.use('/api', requireAuth)
    for (const [prefix, routers] of routeGroups) {
      for (const router of routers) kernel.app.use(prefix, router)
    }
  },
}
