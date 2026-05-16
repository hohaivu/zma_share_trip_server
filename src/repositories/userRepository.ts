import { query, withTransaction } from '../db/connection'
import { parseJsonb, parseNumeric, toCamelCase } from '../db/utils'
import { BootstrapSession, Identity, User } from '../types/entities'
import {
  CreateNotificationPayload,
  CreateReportPayload,
  CreateReviewPayload,
  BootstrapResult,
  UpdateUserPayload,
} from '../types/payloads'

export function mapUser(row: Record<string, unknown>): User {
  const user = toCamelCase<User>(row)
  if (!user) throw new Error('Cannot map null row to User')
  user.ratingAvg = parseNumeric(user.ratingAvg)
  user.tripCount = Number(user.tripCount || 0)
  user.blockedUserIds = parseJsonb<string[]>(row.blocked_user_ids) || []
  user.preferredMode = user.preferredMode || user.role || 'client'
  user.activeMode = user.preferredMode
  return user
}

export function mapIdentity(row: Record<string, unknown>): Identity {
  const identity = toCamelCase<Identity>(row)
  if (!identity) throw new Error('Cannot map null row to Identity')
  identity.preferredMode = identity.preferredMode || 'client'
  return identity
}

export function buildSession(
  identity: Identity,
  personas: User[],
  wasCreated: boolean,
): BootstrapSession {
  const driver = personas.find((persona) => persona.role === 'driver')
  const client = personas.find((persona) => persona.role === 'client')
  if (!driver || !client) throw new Error('Identity missing required personas')
  const activeMode = identity.preferredMode === 'driver' ? 'driver' : 'client'
  const activeUser = activeMode === 'driver' ? driver : client
  return {
    identity,
    personas: { driver, client },
    activeMode,
    activeUser: { ...activeUser, activeMode },
    wasCreated,
  }
}

const USER_SELECT_SQL = `
  SELECT u.*, i.mauid, i.display_name, i.avatar_url, i.phone,
         i.preferred_mode, i.mode_selected_at
  FROM users u
  LEFT JOIN identities i ON i.id = u.identity_id
  WHERE u.id = $1
`

const PERSONA_SELECT_SQL = `
  SELECT u.*, i.mauid, i.display_name, i.avatar_url, i.phone,
         i.preferred_mode, i.mode_selected_at
  FROM users u
  JOIN identities i ON i.id = u.identity_id
  WHERE u.identity_id = $1
`

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

async function legacyStore() {
  return import('../store.js')
}

export async function bootstrapUser(
  mauid: string,
  displayName?: string,
  avatarUrl?: string,
): Promise<BootstrapResult> {
  return withTransaction(async (tx) => {
    const existing = await tx.query('SELECT * FROM identities WHERE mauid = $1', [
      mauid,
    ])
    const wasCreated = existing.rows.length === 0
    const identityResult = wasCreated
      ? await tx.query(
          `
          INSERT INTO identities (mauid, display_name, avatar_url, preferred_mode, created_at, updated_at)
          VALUES ($1, $2, $3, 'client', NOW(), NOW())
          RETURNING *
        `,
          [mauid, displayName || '', avatarUrl || ''],
        )
      : await tx.query(
          `
          UPDATE identities
          SET display_name = $1, avatar_url = $2, updated_at = NOW()
          WHERE mauid = $3
          RETURNING *
        `,
          [
            displayName || existing.rows[0].display_name,
            avatarUrl ?? existing.rows[0].avatar_url,
            mauid,
          ],
        )
    const identity = mapIdentity(identityResult.rows[0])

    for (const role of ['driver', 'client']) {
      await tx.query(
        `
        INSERT INTO users (id, identity_id, role, verification_status, rating_avg, trip_count, created_at)
        VALUES ($1, $2, $3, 'unverified', 0, 0, NOW())
        ON CONFLICT DO NOTHING
      `,
        [generateId(`user-${role}`), identity.id, role],
      )
    }

    const personasResult = await tx.query(`${PERSONA_SELECT_SQL} ORDER BY u.role`, [
      identity.id,
    ])
    return {
      session: buildSession(identity, personasResult.rows.map(mapUser), wasCreated),
      wasCreated,
    }
  })
}

export async function findUserById(userId: string): Promise<User | null> {
  const result = await query(USER_SELECT_SQL, [userId])
  return result.rows[0] ? mapUser(result.rows[0]) : null
}

export async function updateUserIdentity(
  identityId: string,
  data: UpdateUserPayload,
): Promise<Identity | null> {
  const result = await query(
    `
    UPDATE identities
    SET display_name = COALESCE($2, display_name),
        avatar_url = COALESCE($3, avatar_url),
        phone = COALESCE($4, phone),
        preferred_mode = COALESCE($5, preferred_mode),
        mode_selected_at = CASE WHEN $5::text IS NULL THEN mode_selected_at ELSE NOW() END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
    [
      identityId,
      data.displayName ?? null,
      data.avatarUrl ?? null,
      data.phone ?? null,
      data.preferredMode ?? null,
    ],
  )
  return result.rows[0] ? mapIdentity(result.rows[0]) : null
}

export async function updateIdentityMode(
  identityId: string,
  mode: string,
): Promise<Identity | null> {
  const result = await query(
    'UPDATE identities SET preferred_mode = $1, mode_selected_at = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *',
    [mode, identityId],
  )
  return result.rows[0] ? mapIdentity(result.rows[0]) : null
}

export async function findIdentityMode(
  identityId: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  const result = await query(
    'SELECT preferred_mode, mode_selected_at FROM identities WHERE id = $1',
    [identityId],
  )
  if (result.rowCount === 0) return null
  return toCamelCase<{ preferredMode: string; modeSelectedAt: string }>(
    result.rows[0],
  )
}

export async function listPersonasByIdentity(
  identityId: string,
): Promise<User[]> {
  const result = await query(`${PERSONA_SELECT_SQL} ORDER BY u.role`, [
    identityId,
  ])
  return result.rows.map(mapUser)
}

export function listReviewsByReviewer(userId: string) {
  return legacyStore().then((store) => store.listReviewsByReviewer(userId))
}

export function createReview(payload: CreateReviewPayload) {
  return legacyStore().then((store) => store.createReview(payload))
}

export function createReport(payload: CreateReportPayload) {
  return legacyStore().then((store) => store.createReport(payload))
}

export function listReportsByReporter(userId: string) {
  return legacyStore().then((store) => store.listReportsByReporter(userId))
}

export function getBlockedUsers(blockerId: string) {
  return legacyStore().then((store) => store.getBlockedUsers(blockerId))
}

export function blockUser(blockerId: string, blockedId: string) {
  return legacyStore().then((store) => store.blockUser(blockerId, blockedId))
}

export function unblockUser(blockerId: string, blockedId: string) {
  return legacyStore().then((store) => store.unblockUser(blockerId, blockedId))
}

export function listNotifications(recipientId: string) {
  return legacyStore().then((store) => store.listNotifications(recipientId))
}

export function createNotification(payload: CreateNotificationPayload) {
  return legacyStore().then((store) => store.createNotification(payload))
}

export function markNotificationRead(recipientId: string, notificationId: string) {
  return legacyStore().then((store) =>
    store.markNotificationRead(recipientId, notificationId),
  )
}

export function markAllNotificationsRead(recipientId: string) {
  return legacyStore().then((store) => store.markAllNotificationsRead(recipientId))
}
