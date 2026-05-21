import { deriveDemandGroups } from '../repositories/demandGroupRepository'
import { getPlan } from '../repositories/planRepository'
import { Plan } from '../types/entities'
import { DemandGroupSummary } from '../types/payloads'

const DEFAULT_VISIBILITY_MODE = 'exact_3_members'

export async function getDemandGroup(id: string): Promise<DemandGroupSummary | null> {
  const groups = await deriveDemandGroups()
  const group = groups.find((candidate) => candidate.id === id)
  if (!group) return null

  return {
    ...group,
    visibilityMode: group.visibilityMode ?? DEFAULT_VISIBILITY_MODE,
  }
}

export async function listDemandGroupMembers(id: string): Promise<Plan[] | null> {
  const group = await getDemandGroup(id)
  if (!group) return null

  const plans = await Promise.all(group.memberPlanIds.map((planId) => getPlan(planId)))
  return plans.filter((plan): plan is Plan => Boolean(plan))
}
