import { Request, Response } from 'express'

import { journeyService, JourneyService } from '../services/journeyService'
import { notFound, requireParam } from './helpers'

export interface JourneysController {
  getJourneySummary(req: Request, res: Response): Promise<void | Response>
  cancelTrip(req: Request, res: Response): Promise<void>
  completeTrip(req: Request, res: Response): Promise<void>
  listSavedLocations(req: Request, res: Response): Promise<void>
  createSavedLocation(req: Request, res: Response): Promise<void>
  deleteSavedLocation(req: Request, res: Response): Promise<void | Response>
}

export function createJourneysController(service: JourneyService): JourneysController {
  return {
    async getJourneySummary(req, res) {
      const { id, viewerId } = req.body || {}
      requireParam(id, 'id is required')
      const summary = await service.getJourneySummary(id, viewerId)
      if (!summary) {
        return notFound(res, 'Trip not found')
      }

      res.json(summary)
    },

    async cancelTrip(req, res) {
      const { id } = req.body || {}
      requireParam(id, 'id is required')
      const canceled = await service.cancelTrip(id)
      res.json(canceled)
    },

    async completeTrip(req, res) {
      const { id } = req.body || {}
      requireParam(id, 'id is required')
      const updated = await service.completeTrip(id)
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
      const { id } = req.body || {}
      requireParam(id, 'id is required')
      const deleted = await service.deleteSavedLocation(id)
      if (!deleted) {
        return notFound(res, 'Saved location not found')
      }
      res.status(204).end()
    },
  }
}

export const journeysController = createJourneysController(journeyService)
