import { Request, Response } from 'express'

import * as store from '../store'
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

      res.json(await store.listGroupOffersByClient(clientIdValue))
    },

    async acceptGroupOffer(req, res) {
      const result = await store.acceptGroupOffer(req.params.id as string)
      res.json(result)
    },

    async declineGroupOffer(req, res) {
      const result = await store.declineGroupOffer(req.params.id as string)
      res.json(result)
    },
  }
}

export const groupOffersController = createGroupOffersController()
