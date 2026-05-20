import { query } from '../db/connection'
import { mapRows } from '../db/utils'
import { Plan } from '../types/entities'
import { DemandGroupSummary } from '../types/payloads'

function buildGroupKey(plan: Plan): string {
  const origin = `${plan.originWardId}_${plan.originProvinceId}`
  const destination = `${plan.destinationWardId}_${plan.destinationProvinceId}`
  return `${plan.departureWindowStartDate.slice(0, 10)}|${origin}|${destination}|${plan.departureWindowStartDate}`
}

export async function deriveDemandGroups(): Promise<DemandGroupSummary[]> {
  const result = await query(
    `
      SELECT *
      FROM plans p
      WHERE p.status = ?
        AND NOT EXISTS (
          SELECT 1
          FROM route_requests sr
          WHERE sr.plan_id = p.id AND sr.status = 'accepted'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM group_offers go
          WHERE go.plan_id = p.id AND go.status = 'accepted'
        )
    `,
    ['published'],
  )

  const grouped = new Map<string, DemandGroupSummary>()
  for (const plan of mapRows<Plan>(result.rows)) {
    const key = buildGroupKey(plan)
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `dg-${key}`,
        departureWindowStartDate: plan.departureWindowStartDate,
        originWardId: plan.originWardId,
        destinationWardId: plan.destinationWardId,
        originProvinceId: plan.originProvinceId,
        destinationProvinceId: plan.destinationProvinceId,
        departureWindowEndDate: plan.departureWindowEndDate,
        memberCount: 0,
        totalPassengerCount: 0,
        memberPlanIds: [],
        origin: typeof plan.origin === 'string' ? JSON.parse(plan.origin) : plan.origin,
        destination: typeof plan.destination === 'string' ? JSON.parse(plan.destination) : plan.destination,
        clientIds: [],
      })
    }
    const group = grouped.get(key)
    if (!group) continue
    group.memberCount += 1
    group.totalPassengerCount += plan.passengerCount
    group.memberPlanIds.push(plan.id)
    group.clientIds.push(plan.clientId)
  }

  return [...grouped.values()]
}

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

  if (group.memberPlanIds.length === 0) return []
  const placeholders = group.memberPlanIds.map(() => '?').join(',')
  const result = await query(
    `SELECT * FROM plans WHERE id IN (${placeholders})`,
    group.memberPlanIds,
  )
  return mapRows<Plan>(result.rows)
}
