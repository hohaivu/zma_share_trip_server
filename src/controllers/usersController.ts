import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import * as userService from '../services/userService'
import {
  BootstrapPayload,
  CreateNotificationPayload,
  CreateReportPayload,
  CreateReviewPayload,
  UpdateUserPayload,
} from '../types/payloads'
import { notFound } from './helpers'

function requireControllerParam(value: unknown, message: string): asserts value {
  if (!value) {
    throw new HttpError(400, message)
  }
}

export interface UsersController {
  bootstrapUser(
    req: Request<Record<string, never>, unknown, BootstrapPayload>,
    res: Response,
  ): Promise<void>
  getUser(req: Request<Record<string, never>, unknown, { id: string }>, res: Response): Promise<void | Response>
  updateUser(
    req: Request<Record<string, never>, unknown, UpdateUserPayload & { id: string }>,
    res: Response,
  ): Promise<void | Response>
  setIdentityMode(req: Request<Record<string, never>, unknown, { id: string; preferredMode: string }>, res: Response): Promise<void | Response>
  getIdentityMode(req: Request<Record<string, never>, unknown, { id: string }>, res: Response): Promise<void | Response>
  setUserMode(req: Request<Record<string, never>, unknown, { id: string; preferredMode: string }>, res: Response): Promise<void | Response>
  getUserMode(req: Request<Record<string, never>, unknown, { id: string }>, res: Response): Promise<void | Response>
  listReviewsByReviewer(req: Request<Record<string, never>, unknown, { id: string }>, res: Response): Promise<void>
  createReview(req: Request, res: Response): Promise<void>
  createReport(req: Request, res: Response): Promise<void>
  listReportsByReporter(req: Request<Record<string, never>, unknown, { id: string }>, res: Response): Promise<void>
  getBlockedUsers(req: Request<Record<string, never>, unknown, { id: string }>, res: Response): Promise<void>
  blockUser(req: Request<Record<string, never>, unknown, { id: string; blockedId: string }>, res: Response): Promise<void>
  unblockUser(req: Request<Record<string, never>, unknown, { id: string; blockedId: string }>, res: Response): Promise<void>
  listNotifications(req: Request<Record<string, never>, unknown, { id: string }>, res: Response): Promise<void>
  createNotification(req: Request<Record<string, never>, unknown, CreateNotificationPayload & { id: string }>, res: Response): Promise<void>
  markNotificationRead(req: Request<Record<string, never>, unknown, { id: string; notificationId: string }>, res: Response): Promise<void | Response>
  markAllNotificationsRead(req: Request<Record<string, never>, unknown, { id: string }>, res: Response): Promise<void>
}

function readId(req: Request, message = 'id is required'): string {
  const { id } = req.body || {}
  requireControllerParam(id, message)
  return id as string
}

function readPreferredMode(req: Request): string {
  const { preferredMode } = req.body || {}
  requireControllerParam(preferredMode, 'preferredMode is required')
  return preferredMode as string
}

export function createUsersController(): UsersController {
  return {
    async bootstrapUser(req, res) {
      const { mauid, displayName, avatarUrl } = req.body
      requireControllerParam(mauid, 'mauid is required')
      requireControllerParam(displayName, 'displayName is required')
      if (avatarUrl === undefined) {
        throw new HttpError(400, 'avatarUrl is required')
      }

      const { session, wasCreated } = await userService.bootstrapUser(
        mauid,
        displayName,
        avatarUrl,
      )

      res.status(wasCreated ? 201 : 200).json(session)
    },

    async getUser(req, res) {
      const user = await userService.getUser(readId(req))
      if (!user) return notFound(res, 'User not found')
      res.json(user)
    },

    async updateUser(req, res) {
      const { id: _id, ...editablePayload } = req.body || {}
      const user = await userService.updateUser(
        readId(req),
        editablePayload,
      )
      if (!user) return notFound(res, 'User not found')
      res.json(user)
    },

    async setIdentityMode(req, res) {
      const result = await userService.setUserMode(
        readId(req),
        readPreferredMode(req),
      )
      if (!result) return notFound(res, 'User not found')
      res.json(result)
    },

    async getIdentityMode(req, res) {
      const result = await userService.getUserMode(readId(req))
      if (!result) return notFound(res, 'User not found')
      res.json(result)
    },

    async setUserMode(req, res) {
      const result = await userService.setModeForUser(
        readId(req),
        readPreferredMode(req),
      )
      if (!result) return notFound(res, 'User not found')
      res.json(result)
    },

    async getUserMode(req, res) {
      const result = await userService.getModeForUser(readId(req))
      if (!result) return notFound(res, 'User not found')
      res.json(result)
    },

    async listReviewsByReviewer(req, res) {
      const reviews = await userService.listReviewsByReviewer(readId(req))
      res.json({ items: reviews })
    },

    async createReview(req, res) {
      const { tripId, reviewerId, revieweeId, rating, comment } = req.body || {}
      requireControllerParam(tripId, 'tripId is required')
      requireControllerParam(reviewerId, 'reviewerId is required')
      requireControllerParam(revieweeId, 'revieweeId is required')
      requireControllerParam(rating, 'rating is required')

      const review = await userService.createReview({
        tripId,
        reviewerId,
        revieweeId,
        rating: Number(rating),
        comment,
      } as CreateReviewPayload)
      res.status(201).json(review)
    },

    async createReport(req, res) {
      const { tripId, reporterId, reporteeId, reason, detail } = req.body || {}
      requireControllerParam(tripId, 'tripId is required')
      requireControllerParam(reporterId, 'reporterId is required')
      requireControllerParam(reporteeId, 'reporteeId is required')
      requireControllerParam(reason, 'reason is required')

      const report = await userService.createReport({
        tripId,
        reporterId,
        reporteeId,
        reason,
        detail,
      } as CreateReportPayload)
      res.status(201).json(report)
    },

    async listReportsByReporter(req, res) {
      const reports = await userService.listReportsByReporter(readId(req))
      res.json({ items: reports })
    },

    async getBlockedUsers(req, res) {
      const blockedUserIds = await userService.getBlockedUsers(readId(req))
      res.json({ blockedUserIds })
    },

    async blockUser(req, res) {
      const { blockedId } = req.body || {}
      requireControllerParam(blockedId, 'blockedId is required')
      const blockedUserIds = await userService.blockUser(readId(req), blockedId)
      res.status(201).json({ blockedUserIds })
    },

    async unblockUser(req, res) {
      const { blockedId } = req.body || {}
      requireControllerParam(blockedId, 'blockedId is required')
      const blockedUserIds = await userService.unblockUser(
        readId(req),
        blockedId as string,
      )
      res.json({ blockedUserIds })
    },

    async listNotifications(req, res) {
      const items = await userService.listNotifications(readId(req))
      res.json({ items })
    },

    async createNotification(req, res) {
      const { type, title, body, targetRoute, deepLink, requestSource, metadata } = req.body || {}
      requireControllerParam(type, 'type is required')
      requireControllerParam(title, 'title is required')
      requireControllerParam(body, 'body is required')

      const notification = await userService.createNotification({
        recipientId: readId(req),
        type,
        title,
        body,
        targetRoute,
        deepLink,
        requestSource,
        metadata,
      } as CreateNotificationPayload)
      res.status(201).json(notification)
    },

    async markNotificationRead(req, res) {
      const { notificationId } = req.body || {}
      requireControllerParam(notificationId, 'notificationId is required')
      const notification = await userService.markNotificationRead(
        readId(req),
        notificationId as string,
      )
      if (!notification) return notFound(res, 'Notification not found')
      res.json(notification)
    },

    async markAllNotificationsRead(req, res) {
      await userService.markAllNotificationsRead(readId(req))
      res.status(204).end()
    },
  }
}

export const usersController = createUsersController()
