import { query } from '../db/connection'
import { parseJsonb, toCamelCase } from '../db/utils'
import { AppNotification } from '../types/entities'
import { CreateNotificationPayload } from '../types/payloads'

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

export function mapAppNotification(row: Record<string, unknown>): AppNotification {
  const notification = toCamelCase<AppNotification>(row)
  if (!notification) throw new Error('Cannot map null row to AppNotification')
  notification.metadata =
    parseJsonb<Record<string, unknown>>(row.metadata) || {}
  return notification
}

export async function listNotifications(
  recipientId: string,
): Promise<AppNotification[]> {
  const result = await query(
    `
      SELECT *
      FROM notifications
      WHERE recipient_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [recipientId],
  )
  return result.rows.map(mapAppNotification)
}

export async function createNotification(
  payload: CreateNotificationPayload,
): Promise<AppNotification> {
  const result = await query(
    `
      INSERT INTO notifications (
        id, recipient_id, type, title, body, target_route, deep_link,
        request_source, metadata, read, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW())
      RETURNING *
    `,
    [
      generateId('notif'),
      payload.recipientId,
      payload.type,
      payload.title,
      payload.body,
      payload.targetRoute || null,
      payload.deepLink || null,
      payload.requestSource || null,
      JSON.stringify(payload.metadata || {}),
    ],
  )
  return mapAppNotification(result.rows[0])
}

export async function markNotificationRead(
  recipientId: string,
  notificationId: string,
): Promise<AppNotification | null> {
  const result = await query(
    `
      UPDATE notifications
      SET read = TRUE, read_at = NOW()
      WHERE id = $1 AND recipient_id = $2
      RETURNING *
    `,
    [notificationId, recipientId],
  )
  return result.rows[0] ? mapAppNotification(result.rows[0]) : null
}

export async function markAllNotificationsRead(recipientId: string): Promise<void> {
  await query(
    `
      UPDATE notifications
      SET read = TRUE, read_at = NOW()
      WHERE recipient_id = $1 AND read = FALSE
    `,
    [recipientId],
  )
}
