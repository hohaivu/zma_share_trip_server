import { groupOfferService } from './groupOfferService'
import { listRouteRequestsByClient } from './routeRequestService'
import { sortClientInboxItems } from '../shared/clientInboxSort'
import type { ClientRequestItem } from '../types/payloads'
import type { GroupOffer, RouteRequest } from '../types/entities'

function mapOfferToClientRequestItem(offer: GroupOffer): ClientRequestItem {
  return {
    id: offer.id,
    source: 'group_offer',
    direction: 'incoming',
    clientId: offer.clientId,
    routeId: offer.routeId,
    driverId: offer.driverId,
    planId: offer.planId,
    tripPrice: offer.tripPrice,
    status: offer.status,
    createdAt: offer.createdAt ?? new Date(0).toISOString(),
  }
}

function mapRouteRequestToClientRequestItem(request: RouteRequest): ClientRequestItem {
  return {
    id: request.id,
    source: 'route_request',
    direction: 'outgoing',
    clientId: request.clientId,
    routeId: request.routeId,
    driverId: request.driverId,
    planId: request.planId,
    tripPrice: request.tripPrice ?? 0,
    status: request.status,
    note: request.note ?? undefined,
    createdAt: request.createdAt ?? new Date(0).toISOString(),
  }
}

export interface ClientInboxService {
  listClientInbox(clientId: string): Promise<ClientRequestItem[]>
}

export const clientInboxService: ClientInboxService = {
  async listClientInbox(clientId) {
    const [offers, routeRequests] = await Promise.all([
      groupOfferService.listGroupOffersByClient(clientId),
      listRouteRequestsByClient(clientId),
    ])
    const items = [
      ...offers.map(mapOfferToClientRequestItem),
      ...routeRequests.map(mapRouteRequestToClientRequestItem),
    ]
    return sortClientInboxItems(items)
  },
}
