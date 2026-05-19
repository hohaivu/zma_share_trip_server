import { getCachedBlockedUsers, getCachedUser } from '../cache'
import { HardFilter } from '../ports'

// Client path: candidate=Route (has driverId), query has clientId
export const clientMutualBlockFilter: HardFilter<{ clientId: string }, { driverId: string }> = {
  name: 'clientMutualBlockFilter',
  async passes(candidate, query, ctx): Promise<boolean> {
    const { driverId } = candidate
    const { clientId } = query

    await getCachedUser(ctx, driverId)

    const driverBlockedIds = await getCachedBlockedUsers(ctx, driverId)
    if (driverBlockedIds.includes(clientId)) return false

    const clientBlockedIds = await getCachedBlockedUsers(ctx, clientId)
    if (clientBlockedIds.includes(driverId)) return false

    return true
  },
}
