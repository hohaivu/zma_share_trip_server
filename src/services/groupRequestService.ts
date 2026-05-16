import { HttpError } from '../http-error'
import { GroupOffer, GroupRequest } from '../types/entities'
import * as groupRequestRepository from '../repositories/groupRequestRepository'
import { emitNotification } from './notificationService'
import { assertUserRole } from './userService'

export interface GroupRequestService {
  createGroupRequest(
    driverId: string,
    routeId: string,
    demandGroupId: string,
    note?: string,
  ): Promise<{ groupRequest: GroupRequest; offers: GroupOffer[] }>
  listGroupRequestsByDriver(driverId: string): Promise<GroupRequest[]>
  cancelGroupRequest(requestId: string): Promise<GroupRequest>
}

export const groupRequestService: GroupRequestService = {
  async createGroupRequest(driverId, routeId, demandGroupId, note) {
    await assertUserRole(driverId, 'driver')

    const group = await groupRequestRepository.getDemandGroup(demandGroupId)
    if (!group) throw new HttpError(404, 'Demand group not found')

    const result = await groupRequestRepository.createGroupRequestWithOffers({
      driverId,
      routeId,
      demandGroupId,
      note,
      memberPlanIds: group.memberPlanIds,
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
