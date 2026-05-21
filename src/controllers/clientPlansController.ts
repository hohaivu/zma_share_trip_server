import { Request, Response } from 'express'

import * as planService from '../services/planService'
import { CreatePlanRequestBody, UpdatePlanPayload } from '../types/payloads'
import { notFound, requireParam } from './helpers'

export interface ClientPlansController {
  createPlan(
    req: Request<Record<string, never>, unknown, CreatePlanRequestBody>,
    res: Response,
  ): Promise<void>
  listPlans(req: Request, res: Response): Promise<void>
  getPlan(req: Request, res: Response): Promise<void | Response>
  updatePlan(
    req: Request<Record<string, never>, unknown, UpdatePlanPayload & { id: string }>,
    res: Response,
  ): Promise<void | Response>
  cancelPlan(req: Request<Record<string, never>, unknown, { id: string; clientId: string }>, res: Response): Promise<void>
}

export function createClientPlansController(): ClientPlansController {
  return {
    async createPlan(req, res) {
      const { clientId, ...data } = req.body || {}
      requireParam(clientId, 'clientId is required')

      const plan = await planService.createPlan(clientId, data)
      res.status(201).json(plan)
    },

    async listPlans(req, res) {
      const { clientId, scope } = req.body || {}
      requireParam(clientId, 'clientId is required')

      res.json(
        await planService.listPlansByClient(
          clientId,
          scope === 'history' ? 'history' : 'active',
        ),
      )
    },

    async getPlan(req, res) {
      const { id } = req.body || {}
      requireParam(id, 'id is required')

      const plan = await planService.getPlan(id)
      if (!plan) {
        return notFound(res, 'Plan not found')
      }

      res.json(plan)
    },

    async updatePlan(req, res) {
      const { id, ...patch } = req.body || {}
      requireParam(id, 'id is required')

      const plan = await planService.updatePlan(id, patch)
      if (!plan) {
        return notFound(res, 'Plan not found')
      }

      res.json(plan)
    },

    async cancelPlan(req, res) {
      const { id, clientId } = req.body || {}
      requireParam(id, 'id is required')
      requireParam(clientId, 'clientId is required')

      const plan = await planService.cancelPlanByClient(id, clientId)
      res.json(plan)
    },
  }
}

export const clientPlansController = createClientPlansController()
