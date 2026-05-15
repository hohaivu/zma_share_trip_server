import { HttpError } from '../http-error'
import { GroupOffer, GroupRequest } from '../types/entities'
import * as groupRequestRepository from '../repositories/groupRequestRepository'
import { query } from '../db/connection'

async function assertUserRole(userId: string, role: 'driver' | 'client'): Promise<void> {
  const result = await query('SELECT role FROM users WHERE id = $1', [userId])
  const user = result.rows[0] as { role?: string } | undefined
  if (!user) throw new HttpError(404, 'User not found')
  if (user.role !== role) throw new HttpError(403, `User must be a ${role} persona`)
}

function emitNotification(type: string, recipientId: string, data: Record<string, unknown>): void {
  const copy = type === 'group_request_canceled'
    ? {
        type: 'request_canceled',
        title: 'Request canceled',
        body: 'A request was canceled.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource: 'group_request',
      }
    : type === 'sibling_offer_closed'
      ? {
          type: 'request_closed',
          title: 'Request closed',
          body: 'This request is no longer available.',
          targetRoute: '/offers',
          deepLink: '/offers',
          requestSource: 'group_offer',
        }
      : {
          type: 'request_received',
          title: 'New request received',
          body: 'You received a new group offer.',
          targetRoute: '/offers',
          deepLink: '/offers',
          requestSource: 'group_offer',
        }

  void query(
    `
      INSERT INTO notifications (
        id, recipient_id, type, title, body, target_route, deep_link,
        request_source, metadata, read, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW())
    `,
    [
      `notif-${Date.now()}${Math.random().toString().slice(2, 6)}`,
      recipientId,
      copy.type,
      copy.title,
      copy.body,
      copy.targetRoute,
      copy.deepLink,
      copy.requestSource,
      JSON.stringify(data),
    ],
  ).catch((error) => {
    console.error('[emitNotification] failed to persist notification', error)
  })
}

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
