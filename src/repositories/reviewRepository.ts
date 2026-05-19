import { query } from '../db/connection'
import { mapRows, toCamelCase } from '../db/utils'
import { Review } from '../types/entities'
import { CreateReviewPayload } from '../types/payloads'

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

export function isMariadbDuplicateEntry(e: unknown, keyName: string): boolean {
  const err = e as Record<string, unknown>
  if (err?.errno !== 1062) return false
  const sqlMessage = typeof err.sqlMessage === 'string' ? err.sqlMessage : ''
  return sqlMessage.includes(keyName)
}

export async function createReview(
  payload: CreateReviewPayload,
): Promise<Review> {
  const result = await query(
    `
      INSERT INTO reviews (id, trip_id, reviewer_id, reviewee_id, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      RETURNING *
    `,
    [
      generateId('review'),
      payload.tripId,
      payload.reviewerId,
      payload.revieweeId,
      payload.rating,
      payload.comment || null,
    ],
  )

  return toCamelCase<Review>(result.rows[0]) as Review
}

export async function listReviewsByReviewer(userId: string): Promise<Review[]> {
  const result = await query(
    'SELECT * FROM reviews WHERE reviewer_id = ? ORDER BY created_at DESC, id DESC',
    [userId],
  )
  return mapRows<Review>(result.rows)
}
