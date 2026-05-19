import { Plan } from '../types/entities'
import { DemandGroupSummary } from '../types/payloads'
import * as demandGroupRepository from '../repositories/demandGroupRepository'

export interface DemandGroupDetail {
  summary: DemandGroupSummary
  members?: Plan[]
}

export interface GetDemandGroupDetailOptions {
  includeMembers: boolean
}

export interface DemandGroupService {
  getDemandGroup(groupId: string): Promise<DemandGroupSummary | null>
  getDemandGroupDetail(
    groupId: string,
    options: GetDemandGroupDetailOptions,
  ): Promise<DemandGroupDetail | null>
  getDemandGroupMembers(groupId: string): Promise<Plan[] | null>
}

type DemandGroupRepository = Pick<
  typeof demandGroupRepository,
  'getDemandGroup' | 'getDemandGroupMembers'
>

export function createDemandGroupService(
  repository: DemandGroupRepository = demandGroupRepository,
): DemandGroupService {
  return {
    getDemandGroup: repository.getDemandGroup,
    async getDemandGroupDetail(groupId, options) {
      const summary = await repository.getDemandGroup(groupId)
      if (!summary) return null

      if (!options.includeMembers) {
        return { summary }
      }

      const members = await repository.getDemandGroupMembers(groupId)
      if (!members) return null

      return { summary, members }
    },
    getDemandGroupMembers: repository.getDemandGroupMembers,
  }
}

export const demandGroupService: DemandGroupService = createDemandGroupService()

export const getDemandGroup = demandGroupService.getDemandGroup
export const getDemandGroupDetail = demandGroupService.getDemandGroupDetail
export const getDemandGroupMembers = demandGroupService.getDemandGroupMembers
