import * as demandGroupRepository from '../../repositories/demandGroupRepository'
import * as routeRequestRepository from '../../repositories/routeRequestRepository'
import { DemandGroupSummary } from '../../types/payloads'
import { CandidateSource } from '../ports'

export const demandGroupsSource: CandidateSource<{ routeId: string }, DemandGroupSummary> = {
  async list(query, _ctx) {
    const groups = await demandGroupRepository.deriveDemandGroups()
    const pendingInboundPlanIds = new Set(
      (await routeRequestRepository.listRouteRequestsByRoute(query.routeId))
        .filter((r) => r.status === 'pending')
        .map((r) => r.planId)
        .filter((planId): planId is string => Boolean(planId)),
    )
    return groups.filter(
      (g) => !g.memberPlanIds.some((planId) => pendingInboundPlanIds.has(planId)),
    )
  },
}
