import { Router } from 'express'

import { usersController } from '../controllers/usersController'
import { asyncHandler } from './helpers'

const router = Router()

router.get(
  '/users/:id',
  asyncHandler(usersController.getUser),
)

router.patch(
  '/users/:id',
  asyncHandler(usersController.updateUser),
)

// POST /api/users/:id/mode — save preferred mode
router.post(
  '/identities/:id/mode',
  asyncHandler(usersController.setIdentityMode),
)

// GET /api/users/:id/mode — read preferred mode
router.get(
  '/identities/:id/mode',
  asyncHandler(usersController.getIdentityMode),
)

router.post(
  '/users/:id/mode',
  asyncHandler(usersController.setUserMode),
)

router.get(
  '/users/:id/mode',
  asyncHandler(usersController.getUserMode),
)

router.get(
  '/users/:id/reviews',
  asyncHandler(usersController.listReviewsByReviewer),
)

router.post(
  '/reviews',
  asyncHandler(usersController.createReview),
)

router.post(
  '/reports',
  asyncHandler(usersController.createReport),
)

router.get(
  '/users/:id/reports',
  asyncHandler(usersController.listReportsByReporter),
)

router.get(
  '/users/:id/blocked-users',
  asyncHandler(usersController.getBlockedUsers),
)

router.post(
  '/users/:id/blocked-users',
  asyncHandler(usersController.blockUser),
)

router.delete(
  '/users/:id/blocked-users/:blockedId',
  asyncHandler(usersController.unblockUser),
)

router.get(
  '/users/:id/notifications',
  asyncHandler(usersController.listNotifications),
)

router.post(
  '/users/:id/notifications',
  asyncHandler(usersController.createNotification),
)

router.post(
  '/users/:id/notifications/:notificationId/read',
  asyncHandler(usersController.markNotificationRead),
)

router.post(
  '/users/:id/notifications/read-all',
  asyncHandler(usersController.markAllNotificationsRead),
)

export default router
