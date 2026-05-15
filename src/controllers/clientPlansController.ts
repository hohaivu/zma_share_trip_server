import { Request, Response } from 'express'

import * as store from '../store'
import { CreatePlanRequestBody, UpdatePlanPayload } from '../types/payloads'
import { requireParam } from '../routes/helpers'

export interface ClientPlansController {
  createPlan(
    req: Request<Record<string, never>, unknown, CreatePlanRequestBody>,
    res: Response,
  ): Promise<void>
  listPlans(req: Request, res: Response): Promise<void>
  getPlan(req: Request, res: Response): Promise<void | Response>
  updatePlan(
    req: Request<{ id: string }, unknown, UpdatePlanPayload>,
    res: Response,
  ): Promise<void | Response>
  cancelPlan(req: Request<{ id: string }>, res: Response): Promise<void>
}

export function createClientPlansController(): ClientPlansController {
  return {
    async createPlan(req, res) {
      const { clientId, ...data } = req.body
      requireParam(clientId, 'clientId is required')

      const plan = await store.createPlan(clientId, data)
      res.status(201).json(plan)
    },

    async listPlans(req, res) {
      const { clientId, scope } = req.query
      requireParam(clientId as string, 'clientId query is required')

      res.json(
        await store.listPlansByClient(
          clientId as string,
          scope === 'history' ? 'history' : 'active',
        ),
      )
    },

    async getPlan(req, res) {
      const plan = await store.getPlan(req.params.id as string)
      if (!plan) {
        return res.status(404).json({ message: 'Plan not found' })
      }

      res.json(plan)
    },

    async updatePlan(req, res) {
      const plan = await store.updatePlan(req.params.id, req.body)
      if (!plan) {
        return res.status(404).json({ message: 'Plan not found' })
      }

      res.json(plan)
    },

    async cancelPlan(req, res) {
      const clientId = (req.body?.clientId ?? req.query.clientId) as string
      requireParam(clientId, 'clientId is required')

      const plan = await store.cancelPlanByClient(req.params.id, clientId)
      res.json(plan)
    },
  }
}

export const clientPlansController = createClientPlansController()
