import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import { groupRequestService } from '../services/groupRequestService'
import { requireQueryString } from './helpers'

function requireBodyParam(value: unknown, message: string): asserts value {
  if (!value) throw new HttpError(400, message)
}

export interface GroupRequestsController {
  createGroupRequest(req: Request, res: Response): Promise<void>
  listGroupRequests(req: Request, res: Response): Promise<void>
  cancelGroupRequest(req: Request, res: Response): Promise<void>
}

export function createGroupRequestsController(): GroupRequestsController {
  return {
    async createGroupRequest(req, res) {
      const { driverId, routeId, demandGroupId, note } = req.body || {}
      requireBodyParam(driverId, 'driverId is required')
      requireBodyParam(routeId, 'routeId is required')
      requireBodyParam(demandGroupId, 'demandGroupId is required')

      const result = await groupRequestService.createGroupRequest(
        driverId,
        routeId,
        demandGroupId,
        note,
      )
      res.status(201).json(result)
    },

    async listGroupRequests(req, res) {
      const driverId = requireQueryString(
        req.query.driverId,
        'driverId query is required',
      )
      res.json(await groupRequestService.listGroupRequestsByDriver(driverId))
    },

    async cancelGroupRequest(req, res) {
      const result = await groupRequestService.cancelGroupRequest(
        req.params.id as string,
      )
      res.json(result)
    },
  }
}

export const groupRequestsController = createGroupRequestsController()
