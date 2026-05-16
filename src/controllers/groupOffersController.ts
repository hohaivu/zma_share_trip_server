import { Request, Response } from 'express'

import { groupOfferService } from '../services/groupOfferService'
import { ok } from '../shared/responseEnvelope'
import { requireQueryString } from './helpers'

export interface GroupOffersController {
  listGroupOffers(req: Request, res: Response): Promise<void>
  acceptGroupOffer(req: Request, res: Response): Promise<void>
  declineGroupOffer(req: Request, res: Response): Promise<void>
}

export function createGroupOffersController(): GroupOffersController {
  return {
    async listGroupOffers(req, res) {
      const { clientId } = req.query
      const clientIdValue = requireQueryString(clientId, 'clientId query is required')

      const items = await groupOfferService.listGroupOffersByClient(clientIdValue)
      const count = Array.isArray(items) ? items.length : undefined
      res.json(ok(items, count !== undefined ? { count } : undefined))
    },

    async acceptGroupOffer(req, res) {
      const result = await groupOfferService.acceptGroupOffer(req.params.id as string)
      res.json(ok(result))
    },

    async declineGroupOffer(req, res) {
      const result = await groupOfferService.declineGroupOffer(req.params.id as string)
      res.json(ok(result))
    },
  }
}

export const groupOffersController = createGroupOffersController()
