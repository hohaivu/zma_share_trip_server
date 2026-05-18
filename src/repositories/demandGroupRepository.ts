import { query } from '../db/connection'
import { mapRows } from '../db/utils'
import { Plan } from '../types/entities'
import { DemandGroupSummary } from '../types/payloads'
import { deriveDemandGroups } from './groupRequestRepository'
import { deriveDemandGroupsForRoute } from './groupRequestRepository'
import { getRoute } from './driverRouteRepository'

export { deriveDemandGroups, deriveDemandGroupsForRoute } from './groupRequestRepository'

export async function getDemandGroup(
  groupId: string,
  routeId?: string,
): Promise<DemandGroupSummary | null> {
  const route = routeId ? await getRoute(routeId) : null
  if (routeId && !route) return null

  const groups = route ? await deriveDemandGroupsForRoute(route) : await deriveDemandGroups()
  return groups.find((group) => group.id === groupId) || null
}

export async function getDemandGroupMembers(
  groupId: string,
  routeId?: string,
): Promise<Plan[] | null> {
  const group = await getDemandGroup(groupId, routeId)
  if (!group) return null

  const result = await query(
    'SELECT * FROM plans WHERE id = ANY($1::varchar[])',
    [group.memberPlanIds],
  )
  return mapRows<Plan>(result.rows)
}
