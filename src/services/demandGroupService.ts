import { Plan } from '../types/entities'
import { DemandGroupSummary } from '../types/payloads'
import * as demandGroupRepository from '../repositories/demandGroupRepository'

export interface DemandGroupService {
  getDemandGroup(groupId: string, routeId?: string): Promise<DemandGroupSummary | null>
  getDemandGroupMembers(groupId: string, routeId?: string): Promise<Plan[] | null>
}

export const demandGroupService: DemandGroupService = {
  getDemandGroup: demandGroupRepository.getDemandGroup,
  getDemandGroupMembers: demandGroupRepository.getDemandGroupMembers,
}

export const getDemandGroup = demandGroupService.getDemandGroup
export const getDemandGroupMembers = demandGroupService.getDemandGroupMembers
