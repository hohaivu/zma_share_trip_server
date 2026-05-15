import { Request, Response } from 'express'

import * as store from '../store'
import { requireParam } from '../routes/helpers'

export interface GroupOffersController {
  listGroupOffers(req: Request, res: Response): Promise<void>
  acceptGroupOffer(req: Request, res: Response): Promise<void>
  declineGroupOffer(req: Request, res: Response): Promise<void>
}

export function createGroupOffersController(): GroupOffersController {
  return {
    async listGroupOffers(req, res) {
      const { clientId } = req.query
      requireParam(clientId as string, 'clientId query is required')

      res.json(await store.listGroupOffersByClient(clientId as string))
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
