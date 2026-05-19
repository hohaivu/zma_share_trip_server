import { query, withTransaction } from '../db/connection'
import { normalizeUtc, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { Plan, Route } from '../types/entities'
import {
  CreatePlanPayload,
  UpdatePlanPayload,
  WithReviewEligibility,
} from '../types/payloads'
import { findUserById } from './userRepository'
import {
  filterTripsByScope,
  findAcceptedPlanMatchTx,
  type TripListScope,
  withReviewEligibility,
} from './tripListRepository'

export type { TripListScope } from './tripListRepository'

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function formatLocalDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isPastDepartureDate(departureDate?: string | null): boolean {
  if (!departureDate) return false
  const date = new Date(departureDate)
  if (Number.isNaN(date.getTime())) return false
  return formatLocalDateValue(date) < formatLocalDateValue(new Date())
}

function assertDepartureDateIsNotPast(departureDate?: string | null): void {
  if (isPastDepartureDate(departureDate)) {
    throw new HttpError(400, 'departureDate cannot be in the past')
  }
}

async function assertUserRole(
  userId: string,
  role: 'driver' | 'client',
): Promise<void> {
  const user = await findUserById(userId)
  if (!user) throw new HttpError(404, 'User not found')
  if (user.role !== role) {
    throw new HttpError(403, `User must be a ${role} persona`)
  }
}

function mapPlan(row: Record<string, unknown>): Plan {
  const plan = toCamelCase<Plan>(row)
  if (!plan) throw new Error('Cannot map null row to Plan')
  return plan
}

async function dynamicUpdate<T>(
  table: string,
  id: string,
  data: Record<string, unknown>,
  jsonFields: string[] = [],
): Promise<T | null> {
  const keys = Object.keys(data).filter((key) => data[key] !== undefined)
  if (keys.length === 0) {
    const existing = await query(`SELECT * FROM ${table} WHERE id = ?`, [id])
    return toCamelCase<T>(existing.rows[0])
  }

  const setClauses = keys.map((key) => `${toSnakeCase(key)} = ?`)
  const timeFields = ['departureDate', 'windowStart', 'windowEnd']
  const vals = keys.map((key) => {
    const val = data[key]
    if (jsonFields.includes(key)) return JSON.stringify(val)
    if (timeFields.includes(key) && val) {
      return new Date(val as string | number | Date).toISOString()
    }
    return val
  })

  await query(
    `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ?`,
    [...vals, id],
  )
  const result = await query(`SELECT * FROM ${table} WHERE id = ?`, [id])
  return toCamelCase<T>(result.rows[0])
}

async function getRouteLocal(id: string): Promise<Route | null> {
  const result = await query('SELECT * FROM routes WHERE id = ?', [id])
  return result.rows[0] ? toCamelCase<Route>(result.rows[0]) : null
}

export async function createPlan(
  clientId: string,
  data: CreatePlanPayload,
): Promise<Plan> {
  await assertUserRole(clientId, 'client')
  assertDepartureDateIsNotPast(data.departureDate)

  const res = await query(
    `
      INSERT INTO plans (
        id, client_id, origin, destination, origin_ward_id, destination_ward_id,
        origin_province_id,
        destination_province_id, departure_date, window_start,
        window_end, passenger_count, publish_mode, notes, status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      RETURNING *
    `,
    [
      generateId('plan'),
      clientId,
      JSON.stringify(data.origin),
      JSON.stringify(data.destination),
      data.originWardId,
      data.destinationWardId,
      data.originProvinceId,
      data.destinationProvinceId,
      normalizeUtc(data.departureDate),
      normalizeUtc(data.windowStart),
      normalizeUtc(data.windowEnd),
      data.passengerCount,
      'grouped',
      data.notes || '',
      data.status || 'published',
    ],
  )
  const plan = toCamelCase<Plan>(res.rows[0])
  if (!plan) throw new Error('Failed to create plan')
  return plan
}

export async function listPlansByClient(
  clientId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Plan>>> {
  await assertUserRole(clientId, 'client')
  const result = await query('SELECT * FROM plans WHERE client_id = ?', [clientId])
  const plans = result.rows.map(mapPlan)
  const filtered = await filterTripsByScope(
    plans,
    scope,
    clientId,
    getRouteLocal,
    getPlan,
  )
  return Promise.all(
    filtered.map((plan) =>
      withReviewEligibility(plan, clientId, getRouteLocal, getPlan),
    ),
  )
}

export async function getPlan(id?: string): Promise<Plan | null> {
  if (!id) return null
  const result = await query('SELECT * FROM plans WHERE id = ?', [id])
  return result.rows[0] ? mapPlan(result.rows[0]) : null
}

export async function updatePlan(
  id: string,
  data: UpdatePlanPayload,
): Promise<Plan | null> {
  assertDepartureDateIsNotPast(data.departureDate)
  return dynamicUpdate<Plan>('plans', id, data as unknown as Record<string, unknown>, [
    'origin',
    'destination',
  ])
}

export async function cancelPlanByClient(
  planId: string,
  clientId: string,
): Promise<Plan> {
  return withTransaction(async (tx) => {
    const planRes = await tx.query('SELECT * FROM plans WHERE id = ? FOR UPDATE', [
      planId,
    ])
    const plan = toCamelCase<Plan>(planRes.rows[0])
    if (!plan) throw new HttpError(404, 'Plan not found')
    if (plan.clientId !== clientId) {
      throw new HttpError(403, 'Client does not own this plan')
    }
    if (plan.status === 'canceled') return plan

    const accepted = await findAcceptedPlanMatchTx(tx, plan)
    if (accepted) throw new HttpError(409, 'Cannot cancel an accepted plan')

    await tx.query(
      "UPDATE plans SET status = 'canceled' WHERE id = ?",
      [plan.id],
    )
    const updatedPlan = await tx.query(
      'SELECT * FROM plans WHERE id = ?',
      [plan.id],
    )
    const canceledPlan = toCamelCase<Plan>(updatedPlan.rows[0])
    if (!canceledPlan) throw new Error('Failed to cancel plan')
    return canceledPlan
  })
}
