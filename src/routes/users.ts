import { Router } from 'express'

import { usersController } from '../controllers/usersController'
import { asyncHandler } from './helpers'

const router = Router()

router.post(
  '/users/get',
  asyncHandler(usersController.getUser),
)

router.post(
  '/users/update',
  asyncHandler(usersController.updateUser),
)

router.post(
  '/identities/mode/update',
  asyncHandler(usersController.setIdentityMode),
)

router.post(
  '/identities/mode/get',
  asyncHandler(usersController.getIdentityMode),
)

router.post(
  '/users/mode/update',
  asyncHandler(usersController.setUserMode),
)

router.post(
  '/users/mode/get',
  asyncHandler(usersController.getUserMode),
)

router.post(
  '/users/reviews/list',
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

router.post(
  '/users/reports/list',
  asyncHandler(usersController.listReportsByReporter),
)

router.post(
  '/users/blocked-users/list',
  asyncHandler(usersController.getBlockedUsers),
)

router.post(
  '/users/blocked-users/create',
  asyncHandler(usersController.blockUser),
)

router.post(
  '/users/blocked-users/delete',
  asyncHandler(usersController.unblockUser),
)

router.post(
  '/users/notifications/list',
  asyncHandler(usersController.listNotifications),
)

router.post(
  '/users/notifications/create',
  asyncHandler(usersController.createNotification),
)

router.post(
  '/users/notifications/read',
  asyncHandler(usersController.markNotificationRead),
)

router.post(
  '/users/notifications/read-all',
  asyncHandler(usersController.markAllNotificationsRead),
)

export default router
