import * as driverRouteRepository from '../../repositories/driverRouteRepository'
import { Route } from '../../types/entities'
import { SearchRoutesCriteriaPayload } from '../../types/payloads'
import { CandidateSource } from '../ports'

export const allRoutesSource: CandidateSource<SearchRoutesCriteriaPayload, Route> = {
  async list(_query, ctx) {
    const routes = await driverRouteRepository.listAllRoutes()
    const result: Route[] = []
    for (const route of routes) {
      if (route.status !== 'published') continue

      let available = ctx.routeAvailableCache.get(route.id)
      if (available === undefined) {
        available = await driverRouteRepository.isRouteAvailable(route.id)
        ctx.routeAvailableCache.set(route.id, available)
      }
      if (!available) continue

      result.push(route)
    }
    return result
  },
}
