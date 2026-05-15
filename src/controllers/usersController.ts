import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import * as userService from '../services/userService'
import { UpdateUserPayload } from '../types/payloads'
import { notFound } from './helpers'

function requireControllerParam(value: unknown, message: string): asserts value {
  if (!value) {
    throw new HttpError(400, message)
  }
}

export interface UsersController {
  getUser(req: Request<{ id: string }>, res: Response): Promise<void | Response>
  updateUser(
    req: Request<{ id: string }, unknown, UpdateUserPayload>,
    res: Response,
  ): Promise<void | Response>
  setIdentityMode(req: Request<{ id: string }>, res: Response): Promise<void | Response>
  getIdentityMode(req: Request<{ id: string }>, res: Response): Promise<void | Response>
  setUserMode(req: Request<{ id: string }>, res: Response): Promise<void | Response>
  getUserMode(req: Request<{ id: string }>, res: Response): Promise<void | Response>
}

function readPreferredMode(req: Request): string {
  const { preferredMode } = req.body || {}
  requireControllerParam(preferredMode, 'preferredMode is required')
  return preferredMode as string
}

export function createUsersController(): UsersController {
  return {
    async getUser(req, res) {
      const user = await userService.getUser(req.params.id as string)
      if (!user) return notFound(res, 'User not found')
      res.json(user)
    },

    async updateUser(req, res) {
      const user = await userService.updateUser(
        req.params.id as string,
        req.body || {},
      )
      if (!user) return notFound(res, 'User not found')
      res.json(user)
    },

    async setIdentityMode(req, res) {
      const result = await userService.setUserMode(
        req.params.id as string,
        readPreferredMode(req),
      )
      if (!result) return notFound(res, 'User not found')
      res.json(result)
    },

    async getIdentityMode(req, res) {
      const result = await userService.getUserMode(req.params.id as string)
      if (!result) return notFound(res, 'User not found')
      res.json(result)
    },

    async setUserMode(req, res) {
      const result = await userService.setModeForUser(
        req.params.id as string,
        readPreferredMode(req),
      )
      if (!result) return notFound(res, 'User not found')
      res.json(result)
    },

    async getUserMode(req, res) {
      const result = await userService.getModeForUser(req.params.id as string)
      if (!result) return notFound(res, 'User not found')
      res.json(result)
    },
  }
}

export const usersController = createUsersController()
