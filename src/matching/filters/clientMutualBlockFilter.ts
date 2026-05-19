import * as userService from '../../services/userService'
import { HardFilter } from '../ports'

// Client path: candidate=Route (has driverId), query has clientId
export const clientMutualBlockFilter: HardFilter<{ clientId: string }, { driverId: string }> = {
  name: 'clientMutualBlockFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    const driverId = candidate.driverId

    if (!ctx.userCache.has(driverId)) {
      const driver = await userService.getUser(driverId)
      ctx.userCache.set(driverId, driver)
    }

    let driverBlockedIds = ctx.blockedUserCache.get(driverId)
    if (!driverBlockedIds) {
      driverBlockedIds = await userService.getBlockedUsers(driverId)
      ctx.blockedUserCache.set(driverId, driverBlockedIds)
    }
    if (driverBlockedIds.includes(query.clientId)) return false

    let clientBlockedIds = ctx.blockedUserCache.get(query.clientId)
    if (!clientBlockedIds) {
      clientBlockedIds = await userService.getBlockedUsers(query.clientId)
      ctx.blockedUserCache.set(query.clientId, clientBlockedIds)
    }
    if (clientBlockedIds.includes(driverId)) return false

    return true
  },
}
