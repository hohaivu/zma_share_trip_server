import { query } from '../db/connection'
import { mapRows } from '../db/utils'
import { routePlanWindowsOverlap } from '../matching/filters/blockOverlapFilter'
import { Plan } from '../types/entities'
import { DemandGroupSummary } from '../types/payloads'

interface GroupKeyable {
  originWardId: string
  originProvinceId: string
  destinationWardId: string
  destinationProvinceId: string
  departureWindowStartDate: string
}

function buildGroupKey(plan: GroupKeyable): string {
  const origin = `${plan.originWardId}_${plan.originProvinceId}`
  const destination = `${plan.destinationWardId}_${plan.destinationProvinceId}`
  return `${plan.departureWindowStartDate.slice(0, 10)}|${origin}|${destination}`
}

export function demandGroupIdFor(plan: GroupKeyable): string {
  return `dg-${buildGroupKey(plan)}`
}

interface RouteWindow {
  start: string
  end: string
}

export async function deriveDemandGroups(routeWindow?: RouteWindow): Promise<DemandGroupSummary[]> {
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
  const plans = mapRows<Plan>(result.rows).filter((plan) => {
    if (!routeWindow) return true
    if (plan.departureWindowStartDate.slice(0, 10) !== routeWindow.start.slice(0, 10)) return false
    return routePlanWindowsOverlap(
      routeWindow.start,
      routeWindow.end,
      plan.departureWindowStartDate,
      plan.departureWindowEndDate,
    )
  })

  for (const plan of plans) {
    const key = buildGroupKey(plan)
    let group = grouped.get(key)
    if (!group) {
      group = {
        id: `dg-${key}`,
        originWardId: plan.originWardId,
        destinationWardId: plan.destinationWardId,
        originProvinceId: plan.originProvinceId,
        destinationProvinceId: plan.destinationProvinceId,
        memberCount: 0,
        totalPassengerCount: 0,
        memberPlanIds: [],
        origin: typeof plan.origin === 'string' ? JSON.parse(plan.origin) : plan.origin,
        destination: typeof plan.destination === 'string' ? JSON.parse(plan.destination) : plan.destination,
        clientIds: [],
      }
      grouped.set(key, group)
    }
    group.memberCount += 1
    group.totalPassengerCount += plan.passengerCount
    group.memberPlanIds.push(plan.id)
    group.clientIds.push(plan.clientId)
  }

  return [...grouped.values()]
}
