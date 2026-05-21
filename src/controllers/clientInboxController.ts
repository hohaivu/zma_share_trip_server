import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import { clientInboxService } from '../services/clientInboxService'
import { ok } from '../shared/responseEnvelope'

function requireBodyParam(value: unknown, message: string): asserts value {
  if (!value) throw new HttpError(400, message)
}

export interface ClientInboxController {
  listClientInbox(req: Request, res: Response): Promise<void>
}

export function createClientInboxController(): ClientInboxController {
  return {
    async listClientInbox(req, res) {
      const { clientId } = req.body || {}
      requireBodyParam(clientId, 'clientId is required')
      const items = await clientInboxService.listClientInbox(clientId)
      res.json(ok(items, { count: items.length }))
    },
  }
}

export const clientInboxController = createClientInboxController()
