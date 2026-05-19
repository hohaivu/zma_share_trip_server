import * as driverRouteRepository from '../../repositories/driverRouteRepository'
import { CandidateSource } from '../ports'

export const allRoutesSource: CandidateSource<unknown, Awaited<ReturnType<typeof driverRouteRepository.listAllRoutes>>[number]> = {
  async list(_query, ctx) {
    const routes = await driverRouteRepository.listAllRoutes()
    const result = []
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
