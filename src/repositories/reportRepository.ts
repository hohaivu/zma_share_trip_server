import { query } from '../db/connection'
import { mapRows, toCamelCase } from '../db/utils'
import { Report } from '../types/entities'
import { CreateReportPayload } from '../types/payloads'

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

export async function createReport(
  payload: CreateReportPayload,
): Promise<Report> {
  const result = await query(
    `
      INSERT INTO reports (id, trip_id, reporter_id, reportee_id, reason, detail, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `,
    [
      generateId('report'),
      payload.tripId,
      payload.reporterId,
      payload.reporteeId,
      payload.reason,
      payload.detail || null,
    ],
  )
  return toCamelCase<Report>(result.rows[0]) as Report
}

export async function listReportsByReporter(userId: string): Promise<Report[]> {
  const result = await query(
    'SELECT * FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC, id DESC',
    [userId],
  )
  return mapRows<Report>(result.rows)
}
