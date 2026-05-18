import { HttpError } from '../http-error'
import { GroupRequest, GroupRequestCreateResult, GroupRequestWithOffers } from '../types/entities'
import * as driverRouteRepository from '../repositories/driverRouteRepository'
import * as groupRequestRepository from '../repositories/groupRequestRepository'
import { emitNotification } from './notificationService'
import { assertUserRole } from './userService'

export interface GroupRequestService {
  createGroupRequest(
    driverId: string,
    routeId: string,
    demandGroupId: string,
    note?: string,
    targetPlanId?: string,
  ): Promise<GroupRequestCreateResult>
  listGroupRequestsByDriver(driverId: string): Promise<GroupRequestWithOffers[]>
  cancelGroupRequest(requestId: string): Promise<GroupRequest>
}

export const groupRequestService: GroupRequestService = {
  async createGroupRequest(driverId, routeId, demandGroupId, note, targetPlanId) {
    await assertUserRole(driverId, 'driver')

    let group = await groupRequestRepository.getDemandGroup(demandGroupId)
    if (!group) {
      const route = await driverRouteRepository.getRoute(routeId)
      const routeScopedGroups = route
        ? await groupRequestRepository.deriveDemandGroupsForRoute(route)
        : []
      group = routeScopedGroups.find((item) => item.id === demandGroupId) || null
    }
    if (!group) throw new HttpError(404, 'Demand group not found')

    const memberPlanIds = targetPlanId ? [targetPlanId] : group.memberPlanIds
    if (targetPlanId && !group.memberPlanIds.includes(targetPlanId)) {
      throw new HttpError(400, 'targetPlanId must belong to demand group')
    }

    const result = await groupRequestRepository.createGroupRequestWithOffers({
      driverId,
      routeId,
      demandGroupId,
      note,
      memberPlanIds,
      targetPlanId,
    })

    for (const offer of result.offers) {
      emitNotification('group_offer_received', offer.clientId, {
        groupOfferId: offer.id,
        groupRequestId: result.groupRequest.id,
        driverId,
        routeId,
      })
    }

    return result
  },

  async listGroupRequestsByDriver(driverId) {
    await assertUserRole(driverId, 'driver')
    return groupRequestRepository.listGroupRequestsByDriver(driverId)
  },

  async cancelGroupRequest(requestId) {
    const result = await groupRequestRepository.cancelGroupRequestWithOffers(requestId)

    for (const offer of result.closedOffers) {
      emitNotification('sibling_offer_closed', offer.clientId, {
        groupOfferId: offer.id,
        reason: 'group_request_canceled',
      })
    }

    emitNotification('group_request_canceled', result.groupRequest.driverId, {
      groupRequestId: requestId,
    })

    return result.groupRequest
  },
}

export const createGroupRequest = groupRequestService.createGroupRequest
export const listGroupRequestsByDriver = groupRequestService.listGroupRequestsByDriver
export const cancelGroupRequest = groupRequestService.cancelGroupRequest
