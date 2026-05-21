import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import { groupOfferService } from '../services/groupOfferService'
import { ok } from '../shared/responseEnvelope'

function requireBodyParam(value: unknown, message: string): asserts value {
  if (!value) throw new HttpError(400, message)
}

export interface GroupOffersController {
  listGroupOffers(req: Request, res: Response): Promise<void>
  acceptGroupOffer(req: Request, res: Response): Promise<void>
  declineGroupOffer(req: Request, res: Response): Promise<void>
}

export function createGroupOffersController(): GroupOffersController {
  return {
    async listGroupOffers(req, res) {
      const { clientId } = req.body || {}
      requireBodyParam(clientId, 'clientId is required')

      const items = await groupOfferService.listGroupOffersByClient(clientId)
      const count = Array.isArray(items) ? items.length : undefined
      res.json(ok(items, count !== undefined ? { count } : undefined))
    },

    async acceptGroupOffer(req, res) {
      const { id } = req.body || {}
      requireBodyParam(id, 'id is required')
      const result = await groupOfferService.acceptGroupOffer(id)
      res.json(ok(result))
    },

    async declineGroupOffer(req, res) {
      const { id } = req.body || {}
      requireBodyParam(id, 'id is required')
      const result = await groupOfferService.declineGroupOffer(id)
      res.json(ok(result))
    },
  }
}

export const groupOffersController = createGroupOffersController()
