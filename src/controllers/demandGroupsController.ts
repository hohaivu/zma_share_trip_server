import { Request, Response } from 'express'

import * as store from '../store'
import { notFound } from './helpers'

export interface DemandGroupsController {
  getDemandGroup(req: Request, res: Response): Promise<void | Response>
  getDemandGroupMembers(req: Request, res: Response): Promise<void | Response>
}

export function createDemandGroupsController(): DemandGroupsController {
  return {
    async getDemandGroup(req, res) {
      const group = await store.getDemandGroup(req.params.id as string)
      if (!group) {
        return notFound(res, 'Demand group not found')
      }

      res.json(group)
    },

    async getDemandGroupMembers(req, res) {
      const members = await store.getDemandGroupMembers(req.params.id as string)
      if (!members) {
        return notFound(res, 'Demand group not found')
      }
      res.json(members)
    },
  }
}

export const demandGroupsController = createDemandGroupsController()
