import { HttpError } from '../http-error'
import { GroupOffer } from '../types/entities'
import type { HydratedClientGroupOffer } from '../types/payloads'
import * as groupOfferRepository from '../repositories/groupOfferRepository'
import { emitNotification } from './notificationService'
import { assertUserRole } from './userService'

export interface GroupOfferService {
  listGroupOffersByClient(clientId: string, statuses?: string[]): Promise<HydratedClientGroupOffer[]>
  acceptGroupOffer(offerId: string): Promise<GroupOffer>
  declineGroupOffer(offerId: string): Promise<GroupOffer>
}

export const groupOfferService: GroupOfferService = {
  async listGroupOffersByClient(clientId, statuses) {
    await assertUserRole(clientId, 'client')
    return groupOfferRepository.listGroupOffersByClient(clientId, statuses)
  },

  async acceptGroupOffer(offerId) {
    const result = await groupOfferRepository.acceptGroupOfferTx(offerId)

    if (result.status === 'not_found') {
      throw new HttpError(404, 'Group offer not found')
    }
    if (result.status === 'already_accepted') {
      return result.updatedOffer!
    }
    if (result.status === 'not_pending') {
      throw new HttpError(409, `Cannot accept offer in status: ${result.offer!.status}`)
    }
    if (result.status === 'route_unpublished') {
      throw new HttpError(
        409,
        `Cannot accept offer on route in status: ${result.routeStatus}`,
      )
    }
    if (result.status === 'route_unavailable') {
      throw new HttpError(
        409,
        'Route is no longer available — another client was accepted first',
      )
    }

    const updatedOffer = result.updatedOffer!
    const siblings = result.siblings ?? []
    const offer = result.offer!

    for (const sibling of siblings) {
      emitNotification('sibling_offer_closed', sibling.clientId, {
        groupOfferId: sibling.id,
        reason: 'another_client_accepted',
      })
    }
    emitNotification('group_offer_accepted', offer.driverId, {
      groupOfferId: offerId,
      clientId: offer.clientId,
      routeId: offer.routeId,
    })

    return updatedOffer
  },

  async declineGroupOffer(offerId) {
    const offer = await groupOfferRepository.getGroupOfferById(offerId)
    if (!offer) throw new HttpError(404, 'Group offer not found')
    if (offer.status !== 'pending') {
      throw new HttpError(409, `Cannot decline offer in status: ${offer.status}`)
    }

    const updated = await groupOfferRepository.markGroupOfferDeclined(offerId)
    if (!updated) throw new Error('Failed to update group offer')

    emitNotification('group_offer_declined', updated.driverId, {
      groupOfferId: offerId,
      clientId: updated.clientId,
    })

    return updated
  },
}

export const listGroupOffersByClient = groupOfferService.listGroupOffersByClient
export const acceptGroupOffer = groupOfferService.acceptGroupOffer
export const declineGroupOffer = groupOfferService.declineGroupOffer
