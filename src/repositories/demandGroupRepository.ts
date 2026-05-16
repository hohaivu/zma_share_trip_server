import { query } from '../db/connection'
import { mapRows } from '../db/utils'
import { Plan } from '../types/entities'
import { DemandGroupSummary } from '../types/payloads'
import { deriveDemandGroups } from './groupRequestRepository'

export { deriveDemandGroups }

export async function getDemandGroup(
  groupId: string,
): Promise<DemandGroupSummary | null> {
  const groups = await deriveDemandGroups()
  return groups.find((group) => group.id === groupId) || null
}

export async function getDemandGroupMembers(
  groupId: string,
): Promise<Plan[] | null> {
  const group = await getDemandGroup(groupId)
  if (!group) return null

  const result = await query(
    'SELECT * FROM plans WHERE id = ANY($1::varchar[])',
    [group.memberPlanIds],
  )
  return mapRows<Plan>(result.rows)
}
