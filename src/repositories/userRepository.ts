import { query, withTransaction } from '../db/connection'
import { parseJsonb, parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { listReportsByReporter as listReportsByReporterFromRepository } from './reportRepository'
import { listReviewsByReviewer as listReviewsByReviewerFromRepository } from './reviewRepository'
import { BootstrapSession, Identity, User } from '../types/entities'
import { BootstrapResult, UpdateUserPayload } from '../types/payloads'

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
  WHERE u.id = ?
`

const PERSONA_SELECT_SQL = `
  SELECT u.*, i.mauid, i.display_name, i.avatar_url, i.phone,
         i.preferred_mode, i.mode_selected_at
  FROM users u
  JOIN identities i ON i.id = u.identity_id
  WHERE u.identity_id = ?
`

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export async function bootstrapUser(
  mauid: string,
  displayName?: string,
  avatarUrl?: string,
): Promise<BootstrapResult> {
  return withTransaction(async (tx) => {
    const existing = await tx.query('SELECT * FROM identities WHERE mauid = ?', [
      mauid,
    ])
    const wasCreated = existing.rows.length === 0
    let identity: Identity
    if (wasCreated) {
      const identityResult = await tx.query(
        `
          INSERT INTO identities (mauid, display_name, avatar_url, preferred_mode, created_at, updated_at)
          VALUES (?, ?, ?, 'client', NOW(), NOW())
          RETURNING *
        `,
        [mauid, displayName || '', avatarUrl || ''],
      )
      identity = mapIdentity(identityResult.rows[0])
    } else {
      await tx.query(
        `
          UPDATE identities
          SET display_name = ?, avatar_url = ?, updated_at = NOW()
          WHERE mauid = ?
        `,
        [
          displayName || existing.rows[0].display_name,
          avatarUrl ?? existing.rows[0].avatar_url,
          mauid,
        ],
      )
      const identityResult = await tx.query(
        'SELECT * FROM identities WHERE mauid = ?',
        [mauid],
      )
      identity = mapIdentity(identityResult.rows[0])
    }

    for (const role of ['driver', 'client']) {
      await tx.query(
        `
        INSERT IGNORE INTO users (id, identity_id, role, verification_status, rating_avg, trip_count, created_at)
        VALUES (?, ?, ?, 'unverified', 0, 0, NOW())
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
  await query(
    `
    UPDATE identities
    SET display_name = COALESCE(?, display_name),
        avatar_url = COALESCE(?, avatar_url),
        phone = COALESCE(?, phone),
        preferred_mode = COALESCE(?, preferred_mode),
        mode_selected_at = CASE WHEN ? IS NULL THEN mode_selected_at ELSE NOW() END,
        updated_at = NOW()
    WHERE id = ?
  `,
    [
      data.displayName ?? null,
      data.avatarUrl ?? null,
      data.phone ?? null,
      data.preferredMode ?? null,
      data.preferredMode ?? null,
      identityId,
    ],
  )
  const result = await query('SELECT * FROM identities WHERE id = ?', [identityId])
  return result.rows[0] ? mapIdentity(result.rows[0]) : null
}

export async function updateIdentityMode(
  identityId: string,
  mode: string,
): Promise<Identity | null> {
  await query(
    'UPDATE identities SET preferred_mode = ?, mode_selected_at = NOW(), updated_at = NOW() WHERE id = ?',
    [mode, identityId],
  )
  const result = await query('SELECT * FROM identities WHERE id = ?', [identityId])
  return result.rows[0] ? mapIdentity(result.rows[0]) : null
}

export async function findIdentityMode(
  identityId: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  const result = await query(
    'SELECT preferred_mode, mode_selected_at FROM identities WHERE id = ?',
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
  return listReviewsByReviewerFromRepository(userId)
}

export function listReportsByReporter(userId: string) {
  return listReportsByReporterFromRepository(userId)
}

export async function getBlockedUsers(blockerId: string): Promise<string[]> {
  const blocker = await findUserById(blockerId)
  if (!blocker?.identityId) throw new HttpError(404, 'User not found')

  const result = await query(
    `
      SELECT u.id
      FROM identity_blocks b
      JOIN users u ON u.identity_id = b.blocked_identity_id
      WHERE b.blocker_identity_id = ?
      ORDER BY u.id
    `,
    [blocker.identityId],
  )
  return result.rows.map((row) => String(row.id))
}

export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<string[]> {
  const blocker = await findUserById(blockerId)
  const blocked = await findUserById(blockedId)
  if (!blocker?.identityId || !blocked?.identityId) {
    throw new HttpError(404, 'User not found')
  }

  await query(
    `
      INSERT IGNORE INTO identity_blocks (blocker_identity_id, blocked_identity_id, created_at)
      VALUES (?, ?, NOW())
    `,
    [blocker.identityId, blocked.identityId],
  )
  return getBlockedUsers(blockerId)
}

export async function unblockUser(
  blockerId: string,
  blockedId: string,
): Promise<string[]> {
  const blocker = await findUserById(blockerId)
  const blocked = await findUserById(blockedId)
  if (!blocker?.identityId || !blocked?.identityId) {
    throw new HttpError(404, 'User not found')
  }

  await query(
    `
      DELETE FROM identity_blocks
      WHERE blocker_identity_id = ? AND blocked_identity_id = ?
    `,
    [blocker.identityId, blocked.identityId],
  )
  return getBlockedUsers(blockerId)
}
