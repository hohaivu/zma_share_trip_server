import { Request, Response, Router } from 'express'

import * as store from '../store'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

router.get(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await store.getUser(req.params.id as string)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(user)
  }),
)

router.patch(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await store.updateUser(req.params.id as string, req.body || {})
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(user)
  }),
)

// POST /api/users/:id/mode — save preferred mode
router.post(
  '/users/:id/mode',
  asyncHandler(async (req: Request, res: Response) => {
    const { preferredMode } = req.body || {}
    requireParam(preferredMode, 'preferredMode is required')

    const result = await store.setUserMode(
      req.params.id as string,
      preferredMode,
    )
    if (!result) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(result)
  }),
)

// GET /api/users/:id/mode — read preferred mode
router.get(
  '/users/:id/mode',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await store.getUserMode(req.params.id as string)
    if (!result) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(result)
  }),
)

router.get(
  '/users/:id/reviews',
  asyncHandler(async (req: Request, res: Response) => {
    const reviews = await store.listReviewsByReviewer(req.params.id as string)
    res.json({ items: reviews })
  }),
)

router.post(
  '/reviews',
  asyncHandler(async (req: Request, res: Response) => {
    const { tripId, reviewerId, revieweeId, rating, comment } = req.body || {}
    requireParam(tripId, 'tripId is required')
    requireParam(reviewerId, 'reviewerId is required')
    requireParam(revieweeId, 'revieweeId is required')
    requireParam(rating, 'rating is required')

    const review = await store.createReview({
      tripId,
      reviewerId,
      revieweeId,
      rating: Number(rating),
      comment,
    })
    res.status(201).json(review)
  }),
)

router.post(
  '/reports',
  asyncHandler(async (req: Request, res: Response) => {
    const { tripId, reporterId, reporteeId, reason, detail } = req.body || {}
    requireParam(tripId, 'tripId is required')
    requireParam(reporterId, 'reporterId is required')
    requireParam(reporteeId, 'reporteeId is required')
    requireParam(reason, 'reason is required')

    const report = await store.createReport({
      tripId,
      reporterId,
      reporteeId,
      reason,
      detail,
    })
    res.status(201).json(report)
  }),
)

router.get(
  '/users/:id/reports',
  asyncHandler(async (req: Request, res: Response) => {
    const reports = await store.listReportsByReporter(req.params.id as string)
    res.json({ items: reports })
  }),
)

router.get(
  '/users/:id/blocked-users',
  asyncHandler(async (req: Request, res: Response) => {
    const blockedUserIds = await store.getBlockedUsers(req.params.id as string)
    res.json({ blockedUserIds })
  }),
)

router.post(
  '/users/:id/blocked-users',
  asyncHandler(async (req: Request, res: Response) => {
    const { blockedId } = req.body || {}
    requireParam(blockedId, 'blockedId is required')
    const blockedUserIds = await store.blockUser(
      req.params.id as string,
      blockedId,
    )
    res.status(201).json({ blockedUserIds })
  }),
)

router.delete(
  '/users/:id/blocked-users/:blockedId',
  asyncHandler(async (req: Request, res: Response) => {
    const blockedUserIds = await store.unblockUser(
      req.params.id as string,
      req.params.blockedId as string,
    )
    res.json({ blockedUserIds })
  }),
)

router.get(
  '/users/:id/notifications',
  asyncHandler(async (req: Request, res: Response) => {
    const items = await store.listNotifications(req.params.id as string)
    res.json({ items })
  }),
)

router.post(
  '/users/:id/notifications',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      type,
      title,
      body,
      targetRoute,
      deepLink,
      requestSource,
      metadata,
    } = req.body || {}
    requireParam(type, 'type is required')
    requireParam(title, 'title is required')
    requireParam(body, 'body is required')

    const notification = await store.createNotification({
      recipientId: req.params.id as string,
      type,
      title,
      body,
      targetRoute,
      deepLink,
      requestSource,
      metadata,
    })
    res.status(201).json(notification)
  }),
)

router.post(
  '/users/:id/notifications/:notificationId/read',
  asyncHandler(async (req: Request, res: Response) => {
    const notification = await store.markNotificationRead(
      req.params.id as string,
      req.params.notificationId as string,
    )
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' })
    }
    res.json(notification)
  }),
)

router.post(
  '/users/:id/notifications/read-all',
  asyncHandler(async (req: Request, res: Response) => {
    await store.markAllNotificationsRead(req.params.id as string)
    res.status(204).end()
  }),
)

export default router
