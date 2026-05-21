import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import { groupRequestService } from '../services/groupRequestService'

function requireBodyParam(value: unknown, message: string): asserts value {
  if (!value) throw new HttpError(400, message)
}

function requireStringArray(value: unknown, message: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) {
    throw new HttpError(400, message)
  }
}

export interface GroupRequestsController {
  createGroupRequest(req: Request, res: Response): Promise<void>
  listGroupRequests(req: Request, res: Response): Promise<void>
  cancelGroupRequest(req: Request, res: Response): Promise<void>
}

export function createGroupRequestsController(): GroupRequestsController {
  return {
    async createGroupRequest(req, res) {
      const { driverId, routeId, demandGroupId, memberPlanIds, note } = req.body || {}
      requireBodyParam(driverId, 'driverId is required')
      requireBodyParam(routeId, 'routeId is required')
      requireBodyParam(demandGroupId, 'demandGroupId is required')
      requireStringArray(memberPlanIds, 'memberPlanIds is required')

      const result = await groupRequestService.createGroupRequest(
        driverId,
        routeId,
        demandGroupId,
        memberPlanIds,
        note,
      )
      res.status(201).json(result)
    },

    async listGroupRequests(req, res) {
      const { driverId } = req.body || {}
      requireBodyParam(driverId, 'driverId is required')
      res.json(await groupRequestService.listGroupRequestsByDriver(driverId))
    },

    async cancelGroupRequest(req, res) {
      const { id } = req.body || {}
      requireBodyParam(id, 'id is required')
      const result = await groupRequestService.cancelGroupRequest(
        id,
      )
      res.json(result)
    },
  }
}

export const groupRequestsController = createGroupRequestsController()
