import { getCachedBlockedUsers, getCachedUser } from '../cache'
import { HardFilter } from '../ports'

interface WithClientIds {
  clientIds: string[]
}

export const mutualBlockFilter: HardFilter<unknown, WithClientIds> = {
  name: 'mutualBlockFilter',
  async passes(candidate, _query, ctx): Promise<boolean> {
    if (!ctx.driver) return true

    const driverId = ctx.driver.id
    const driverBlockedIds = await getCachedBlockedUsers(ctx, driverId)

    for (const clientId of candidate.clientIds) {
      const client = await getCachedUser(ctx, clientId)
      if (!client) continue

      const clientBlockedIds = await getCachedBlockedUsers(ctx, clientId)
      if (driverBlockedIds.includes(clientId) || clientBlockedIds.includes(driverId)) {
        return false
      }
    }

    return true
  },
}
