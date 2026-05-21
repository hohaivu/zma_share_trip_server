import * as demandGroupRepository from '../../repositories/demandGroupRepository'
import * as planRepository from '../../repositories/planRepository'
import * as routeRequestRepository from '../../repositories/routeRequestRepository'
import { DemandGroupSummary } from '../../types/payloads'
import { CandidateSource } from '../ports'

interface DemandGroupsQuery {
  routeId: string
  departureWindowStartDate: string
  departureWindowEndDate: string
}

export interface DemandGroupCandidate extends DemandGroupSummary {
  departureWindowStartDate: string
  departureWindowEndDate: string
}

async function trimUnavailableMembers(
  group: DemandGroupSummary,
  unavailablePlanIds: Set<string>,
): Promise<DemandGroupSummary | null> {
  const survivorPlanIds = group.memberPlanIds.filter((planId) => !unavailablePlanIds.has(planId))
  if (survivorPlanIds.length === 0) return null
  if (survivorPlanIds.length === group.memberPlanIds.length) return group

  const survivorPlans = []
  for (const planId of survivorPlanIds) {
    const plan = await planRepository.getPlan(planId)
    if (plan) survivorPlans.push(plan)
  }
  if (survivorPlans.length === 0) return null

  return {
    ...group,
    memberCount: survivorPlans.length,
    totalPassengerCount: survivorPlans.reduce((sum, plan) => sum + plan.passengerCount, 0),
    memberPlanIds: survivorPlans.map((plan) => plan.id),
    clientIds: survivorPlans.map((plan) => plan.clientId),
  }
}

export const demandGroupsSource: CandidateSource<DemandGroupsQuery, DemandGroupCandidate> = {
  async list(query) {
    const groups = await demandGroupRepository.deriveDemandGroups({
      start: query.departureWindowStartDate,
      end: query.departureWindowEndDate,
    })
    const routeRequests = await routeRequestRepository.listRouteRequestsByRoute(query.routeId)
    const pendingInboundPlanIds = new Set(
      routeRequests
        .filter((r) => r.status === 'pending')
        .map((r) => r.planId)
        .filter((planId): planId is string => Boolean(planId)),
    )
    const trimmedGroups = await Promise.all(
      groups.map((group) => trimUnavailableMembers(group, pendingInboundPlanIds)),
    )

    return trimmedGroups
      .filter((g): g is DemandGroupSummary => Boolean(g))
      .map((g) => ({
        ...g,
        departureWindowStartDate: query.departureWindowStartDate,
        departureWindowEndDate: query.departureWindowEndDate,
      }))
  },
}
