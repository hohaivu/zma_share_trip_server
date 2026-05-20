import * as demandGroupRepository from '../../repositories/demandGroupRepository'
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
    return groups
      .filter((g) => !g.memberPlanIds.some((planId) => pendingInboundPlanIds.has(planId)))
      .map((g) => ({
        ...g,
        departureWindowStartDate: query.departureWindowStartDate,
        departureWindowEndDate: query.departureWindowEndDate,
      }))
  },
}
