import express from 'express'

import { Kernel, Provider } from '../kernel'
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
import zaloRoutesRoute from '../routes/zaloRoutes'

const routeGroups: Array<[string, express.Router[]]> = [
  ['/api', [zaloRoutesRoute, vnmapRoutesRoute, journeysRoute, usersRoute, bootstrapRoute]],
  [
    '/api/driver',
    [
      carsRoute,
      driverRoutesRoute,
      driverWalletRoute,
      groupRequestsRoute,
      demandGroupsRoute,
      driverMatchesRoute,
      driverRouteRequestsRoute,
    ],
  ],
  [
    '/api/client',
    [clientInboxRoute, clientPlansRoute, groupOffersRoute, clientMatchesRoute, clientRouteRequestsRoute],
  ],
]

export const routeProvider: Provider = {
  name: 'routes',
  register(kernel: Kernel) {
    for (const [prefix, routers] of routeGroups) {
      for (const router of routers) kernel.app.use(prefix, router)
    }
  },
}
