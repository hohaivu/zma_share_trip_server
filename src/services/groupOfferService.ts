import { GroupOffer } from '../types/entities'
import * as groupOfferRepository from '../repositories/groupOfferRepository'

export interface GroupOfferService {
  listGroupOffersByClient(clientId: string): Promise<GroupOffer[]>
  acceptGroupOffer(offerId: string): Promise<GroupOffer>
  declineGroupOffer(offerId: string): Promise<GroupOffer>
}

export const groupOfferService: GroupOfferService = {
  async listGroupOffersByClient(clientId) {
    await groupOfferRepository.assertUserRole(clientId, 'client')
    return groupOfferRepository.listGroupOffersByClient(clientId)
  },

  async acceptGroupOffer(offerId) {
    const result = await groupOfferRepository.acceptGroupOffer(offerId)
    for (const sibling of result.siblings) {
      groupOfferRepository.emitNotification('sibling_offer_closed', sibling.clientId, { groupOfferId: sibling.id, reason: 'another_client_accepted' })
    }
    groupOfferRepository.emitNotification('group_offer_accepted', result.offer.driverId, { groupOfferId: offerId, clientId: result.offer.clientId, routeId: result.offer.routeId })
    return result.updatedOffer
  },

  async declineGroupOffer(offerId) {
    const updated = await groupOfferRepository.declineGroupOffer(offerId)
    groupOfferRepository.emitNotification('group_offer_declined', updated.driverId, { groupOfferId: offerId, clientId: updated.clientId })
    return updated
  },
}

export const listGroupOffersByClient = groupOfferService.listGroupOffersByClient
export const acceptGroupOffer = groupOfferService.acceptGroupOffer
export const declineGroupOffer = groupOfferService.declineGroupOffer
