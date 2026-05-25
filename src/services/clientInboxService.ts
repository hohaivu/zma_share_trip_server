import { listClientInboxHydrated } from '../repositories/clientInboxRepository'
import type { HydratedClientRequestItem } from '../types/payloads'

export interface ClientInboxService {
  listClientInbox(clientId: string, statuses?: string[]): Promise<HydratedClientRequestItem[]>
}

export const clientInboxService: ClientInboxService = {
  async listClientInbox(clientId, statuses) {
    return listClientInboxHydrated(clientId, statuses)
  },
}
