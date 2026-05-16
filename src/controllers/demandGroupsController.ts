import { Request, Response } from 'express'

import { demandGroupService } from '../services/demandGroupService'
import { notFound } from './helpers'

export interface DemandGroupsController {
  getDemandGroup(req: Request, res: Response): Promise<void | Response>
  getDemandGroupMembers(req: Request, res: Response): Promise<void | Response>
}

export function createDemandGroupsController(): DemandGroupsController {
  return {
    async getDemandGroup(req, res) {
      const group = await demandGroupService.getDemandGroup(req.params.id as string)
      if (!group) {
        return notFound(res, 'Demand group not found')
      }

      res.json(group)
    },

    async getDemandGroupMembers(req, res) {
      const members = await demandGroupService.getDemandGroupMembers(req.params.id as string)
      if (!members) {
        return notFound(res, 'Demand group not found')
      }
      res.json(members)
    },
  }
}

export const demandGroupsController = createDemandGroupsController()
