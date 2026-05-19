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
      const detail = await demandGroupService.getDemandGroupDetail(
        req.params.id as string,
        { includeMembers: req.query.include === 'members' },
      )
      if (!detail) {
        return notFound(res, 'Demand group not found')
      }

      res.json(detail)
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
