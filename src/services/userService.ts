import { HttpError } from '../http-error'
import * as notificationService from './notificationService'
import * as reportService from './reportService'
import * as reviewService from './reviewService'
import * as userRepository from '../repositories/userRepository'
import { AppNotification, BootstrapSession, Report, Review, User } from '../types/entities'
import {
  CreateNotificationPayload,
  CreateReportPayload,
  CreateReviewPayload,
  BootstrapResult,
  UpdateUserPayload,
} from '../types/payloads'

const EDITABLE_USER_FIELDS = new Set<keyof UpdateUserPayload>([
  'displayName',
  'avatarUrl',
  'phone',
  'preferredMode',
])

function assertEditableUserUpdate(data: UpdateUserPayload): void {
  for (const key of Object.keys(data)) {
    if (!EDITABLE_USER_FIELDS.has(key as keyof UpdateUserPayload)) {
      throw new HttpError(400, `Field is not editable: ${key}`)
    }
  }
}

function assertValidMode(mode: string): void {
  if (mode !== 'driver' && mode !== 'client') {
    throw new HttpError(400, 'preferredMode must be driver or client')
  }
}

export async function bootstrapUser(
  mauid: string,
  displayName?: string,
  avatarUrl?: string,
): Promise<BootstrapResult> {
  return userRepository.bootstrapUser(mauid, displayName, avatarUrl)
}

export async function getUser(userId: string): Promise<User | null> {
  return userRepository.findUserById(userId)
}

export async function assertUserRole(
  userId: string,
  role: 'driver' | 'client',
): Promise<void> {
  const user = await getUser(userId)
  if (!user) throw new HttpError(404, 'User not found')
  if (user.role !== role) {
    throw new HttpError(403, `User must be a ${role} persona`)
  }
}

export async function updateUser(
  userId: string,
  data: UpdateUserPayload,
): Promise<User | null> {
  assertEditableUserUpdate(data)
  const user = await userRepository.findUserById(userId)
  if (!user?.identityId) return null
  const identity = await userRepository.updateUserIdentity(user.identityId, data)
  if (!identity) return null
  return userRepository.findUserById(userId)
}

export async function setUserMode(
  identityId: string,
  mode: string,
): Promise<BootstrapSession | null> {
  assertValidMode(mode)
  const identity = await userRepository.updateIdentityMode(identityId, mode)
  if (!identity) return null
  return userRepository.buildSession(
    identity,
    await userRepository.listPersonasByIdentity(identityId),
    false,
  )
}

export async function getUserMode(
  identityId: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  return userRepository.findIdentityMode(identityId)
}

export async function setModeForUser(
  userId: string,
  mode: string,
): Promise<BootstrapSession | null> {
  const user = await userRepository.findUserById(userId)
  return user?.identityId ? setUserMode(user.identityId, mode) : null
}

export async function getModeForUser(
  userId: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  const user = await userRepository.findUserById(userId)
  return user?.identityId ? getUserMode(user.identityId) : null
}

export async function listReviewsByReviewer(userId: string): Promise<Review[]> {
  return reviewService.listReviewsByReviewer(userId)
}

export async function createReview(
  payload: CreateReviewPayload,
): Promise<Review> {
  return reviewService.createReview(payload)
}

export async function createReport(
  payload: CreateReportPayload,
): Promise<Report> {
  return reportService.createReport(payload)
}

export async function listReportsByReporter(userId: string): Promise<Report[]> {
  return reportService.listReportsByReporter(userId)
}

export async function getBlockedUsers(userId: string): Promise<string[]> {
  return userRepository.getBlockedUsers(userId)
}

export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<string[]> {
  return userRepository.blockUser(blockerId, blockedId)
}

export async function unblockUser(
  blockerId: string,
  blockedId: string,
): Promise<string[]> {
  return userRepository.unblockUser(blockerId, blockedId)
}

export async function listNotifications(
  recipientId: string,
): Promise<AppNotification[]> {
  return notificationService.listNotifications(recipientId)
}

export async function createNotification(
  payload: CreateNotificationPayload,
): Promise<AppNotification> {
  return notificationService.createNotification(payload)
}

export async function markNotificationRead(
  recipientId: string,
  notificationId: string,
): Promise<AppNotification | null> {
  return notificationService.markNotificationRead(recipientId, notificationId)
}

export async function markAllNotificationsRead(recipientId: string): Promise<void> {
  return notificationService.markAllNotificationsRead(recipientId)
}
