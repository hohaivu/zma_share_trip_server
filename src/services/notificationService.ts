import * as notificationRepository from '../repositories/notificationRepository'
import { AppNotification, ClientRequestSource } from '../types/entities'
import { CreateNotificationPayload } from '../types/payloads'

function inferRequestSource(type: string): ClientRequestSource | undefined {
  if (type.startsWith('group_')) return 'group_offer'
  if (type.startsWith('route_')) return 'route_request'
  return undefined
}

export function buildNotificationCopy(
  type: string,
  data: Record<string, unknown>,
): Omit<
  AppNotification,
  'id' | 'recipientId' | 'read' | 'readAt' | 'createdAt'
> {
  const requestSource = inferRequestSource(type)

  switch (type) {
    case 'group_offer_received':
    case 'route_request_received':
      return {
        type: 'request_received',
        title: 'New request received',
        body:
          type === 'group_offer_received'
            ? 'You received a new group offer.'
            : 'You received a new direct request.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource,
        metadata: data,
      }
    case 'group_offer_accepted':
    case 'route_request_accepted':
      return {
        type: 'request_accepted',
        title: 'Request accepted',
        body: 'Your request was accepted.',
        targetRoute: '/journeys',
        deepLink: '/journeys',
        requestSource,
        metadata: data,
      }
    case 'group_offer_declined':
    case 'route_request_declined':
      return {
        type: 'request_declined',
        title: 'Request declined',
        body: 'Your request was declined.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource,
        metadata: data,
      }
    case 'group_request_canceled':
    case 'route_request_canceled':
      return {
        type: 'request_canceled',
        title: 'Request canceled',
        body: 'A request was canceled.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource:
          type === 'group_request_canceled'
            ? 'group_request'
            : 'route_request',
        metadata: data,
      }
    case 'sibling_offer_closed':
      return {
        type: 'request_closed',
        title: 'Request closed',
        body: 'This request is no longer available.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource: 'group_offer',
        metadata: data,
      }
    default:
      return {
        type: 'strong_match_available',
        title: 'Notification',
        body: 'You have a new notification.',
        targetRoute: '/notifications',
        deepLink: '/notifications',
        metadata: data,
      }
  }
}

export function emitNotification(
  type: string,
  recipientId: string,
  data: Record<string, unknown>,
): void {
  const copy = buildNotificationCopy(type, data)
  void createNotification({
    recipientId,
    ...copy,
    targetRoute: copy.targetRoute ?? undefined,
    deepLink: copy.deepLink ?? undefined,
    requestSource: copy.requestSource ?? undefined,
    metadata: copy.metadata ?? undefined,
  }).catch((error) => {
    console.error('[emitNotification] failed to persist notification', error)
  })
}

export async function listNotifications(
  recipientId: string,
): Promise<AppNotification[]> {
  return notificationRepository.listNotifications(recipientId)
}

export async function createNotification(
  payload: CreateNotificationPayload,
): Promise<AppNotification> {
  return notificationRepository.createNotification(payload)
}

export async function markNotificationRead(
  recipientId: string,
  notificationId: string,
): Promise<AppNotification | null> {
  return notificationRepository.markNotificationRead(recipientId, notificationId)
}

export async function markAllNotificationsRead(recipientId: string): Promise<void> {
  return notificationRepository.markAllNotificationsRead(recipientId)
}
