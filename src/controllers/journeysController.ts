import { Request, Response } from 'express'

import { journeyService, JourneyService } from '../services/journeyService'

export interface JourneysController {
  getJourneySummary(req: Request<{ id: string }>, res: Response): Promise<void | Response>
  cancelTrip(req: Request<{ id: string }>, res: Response): Promise<void>
  completeTrip(req: Request<{ id: string }>, res: Response): Promise<void>
  listSavedLocations(req: Request, res: Response): Promise<void>
  createSavedLocation(req: Request, res: Response): Promise<void>
  deleteSavedLocation(req: Request<{ id: string }>, res: Response): Promise<void | Response>
}

export function createJourneysController(service: JourneyService): JourneysController {
  return {
    async getJourneySummary(req, res) {
      const summary = await service.getJourneySummary(
        req.params.id,
        req.query.viewerId as string | undefined,
      )
      if (!summary) {
        return res.status(404).json({ message: 'Trip not found' })
      }

      res.json(summary)
    },

    async cancelTrip(req, res) {
      const canceled = await service.cancelTrip(req.params.id)
      res.json(canceled)
    },

    async completeTrip(req, res) {
      const updated = await service.completeTrip(req.params.id)
      res.json(updated)
    },

    async listSavedLocations(_req, res) {
      res.json(await service.listSavedLocations())
    },

    async createSavedLocation(req, res) {
      const location = await service.createSavedLocation(req.body || {})
      res.status(201).json(location)
    },

    async deleteSavedLocation(req, res) {
      const deleted = await service.deleteSavedLocation(req.params.id)
      if (!deleted) {
        return res.status(404).json({ message: 'Saved location not found' })
      }
      res.status(204).end()
    },
  }
}

export const journeysController = createJourneysController(journeyService)
