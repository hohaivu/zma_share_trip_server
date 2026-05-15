import { Request, Response } from 'express'

import * as store from '../store'
import { CreatePlanRequestBody, UpdatePlanPayload } from '../types/payloads'
import { notFound, requireBodyOrQueryString, requireQueryString } from './helpers'

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
      const clientIdValue = requireBodyOrQueryString(
        clientId,
        undefined,
        'clientId is required',
      )

      const plan = await store.createPlan(clientIdValue, data)
      res.status(201).json(plan)
    },

    async listPlans(req, res) {
      const { clientId, scope } = req.query
      const clientIdValue = requireQueryString(clientId, 'clientId query is required')

      res.json(
        await store.listPlansByClient(
          clientIdValue,
          scope === 'history' ? 'history' : 'active',
        ),
      )
    },

    async getPlan(req, res) {
      const plan = await store.getPlan(req.params.id as string)
      if (!plan) {
        return notFound(res, 'Plan not found')
      }

      res.json(plan)
    },

    async updatePlan(req, res) {
      const plan = await store.updatePlan(req.params.id, req.body)
      if (!plan) {
        return notFound(res, 'Plan not found')
      }

      res.json(plan)
    },

    async cancelPlan(req, res) {
      const clientId = requireBodyOrQueryString(
        req.body?.clientId,
        req.query.clientId,
        'clientId is required',
      )

      const plan = await store.cancelPlanByClient(req.params.id, clientId)
      res.json(plan)
    },
  }
}

export const clientPlansController = createClientPlansController()
