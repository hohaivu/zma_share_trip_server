import { Request, Response, Router } from 'express'

import * as store from '../store'
import { CreatePlanRequestBody, UpdatePlanPayload } from '../types/payloads'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

// POST /api/client/trip-plans — create a plan
router.post(
  '/trip-plans',
  asyncHandler(
    async (
      req: Request<Record<string, never>, unknown, CreatePlanRequestBody>,
      res: Response,
    ) => {
      const { clientId, ...data } = req.body
      requireParam(clientId, 'clientId is required')

      const plan = await store.createPlan(clientId, data)
      res.status(201).json(plan)
    },
  ),
)

// GET /api/client/trip-plans?clientId= — list by client
router.get(
  '/trip-plans',
  asyncHandler(async (req: Request, res: Response) => {
    const { clientId, scope } = req.query
    requireParam(clientId as string, 'clientId query is required')

    res.json(
      await store.listPlansByClient(
        clientId as string,
        scope === 'history' ? 'history' : 'active',
      ),
    )
  }),
)

// GET /api/client/trip-plans/:id — detail
router.get(
  '/trip-plans/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await store.getPlan(req.params.id as string)
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' })
    }

    res.json(plan)
  }),
)

// PUT /api/client/trip-plans/:id — update
router.put(
  '/trip-plans/:id',
  asyncHandler(
    async (
      req: Request<{ id: string }, unknown, UpdatePlanPayload>,
      res: Response,
    ) => {
      const plan = await store.updatePlan(req.params.id, req.body)
      if (!plan) {
        return res.status(404).json({ message: 'Plan not found' })
      }

      res.json(plan)
    },
  ),
)

// DELETE /api/client/trip-plans/:id — cancel own plan
router.delete(
  '/trip-plans/:id',
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const clientId = (req.body?.clientId ?? req.query.clientId) as string
    requireParam(clientId, 'clientId is required')

    const plan = await store.cancelPlanByClient(req.params.id, clientId)
    res.json(plan)
  }),
)

export default router
