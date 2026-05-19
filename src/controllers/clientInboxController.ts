import { Request, Response } from 'express'

import { clientInboxService } from '../services/clientInboxService'
import { ok } from '../shared/responseEnvelope'
import { requireQueryString } from './helpers'

export interface ClientInboxController {
  listClientInbox(req: Request, res: Response): Promise<void>
}

export function createClientInboxController(): ClientInboxController {
  return {
    async listClientInbox(req, res) {
      const clientId = requireQueryString(req.query.clientId, 'clientId query is required')
      const items = await clientInboxService.listClientInbox(clientId)
      res.json(ok(items, { count: items.length }))
    },
  }
}

export const clientInboxController = createClientInboxController()
