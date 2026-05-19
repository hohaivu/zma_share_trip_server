import * as userService from '../../services/userService'
import { HardFilter } from '../ports'

interface WithClientIds {
  clientIds: string[]
}

export const mutualBlockFilter: HardFilter<unknown, WithClientIds> = {
  name: 'mutualBlockFilter',
  async passes(candidate, _query, ctx): Promise<boolean> {
    if (!ctx.driver) return true

    const driverId = ctx.driver.id
    let driverBlockedIds = ctx.blockedUserCache.get(driverId)
    if (!driverBlockedIds) {
      driverBlockedIds = await userService.getBlockedUsers(driverId)
      ctx.blockedUserCache.set(driverId, driverBlockedIds)
    }

    const ids = Array.isArray(candidate.clientIds) ? candidate.clientIds : []
    for (const clientId of ids) {
      let client = ctx.userCache.get(clientId)
      if (client === undefined) {
        client = await userService.getUser(clientId)
        ctx.userCache.set(clientId, client)
      }
      if (!client) continue

      let clientBlockedIds = ctx.blockedUserCache.get(clientId)
      if (!clientBlockedIds) {
        clientBlockedIds = await userService.getBlockedUsers(clientId)
        ctx.blockedUserCache.set(clientId, clientBlockedIds)
      }

      if (
        driverBlockedIds.includes(clientId) ||
        clientBlockedIds.includes(driverId)
      ) {
        return false
      }
    }

    return true
  },
}
