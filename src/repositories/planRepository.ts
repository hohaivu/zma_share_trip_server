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

function isPastServiceDate(serviceDate?: string | null): boolean {
  if (!serviceDate) return false
  return serviceDate < formatLocalDateValue(new Date())
}

function assertServiceDateIsNotPast(serviceDate?: string | null): void {
  if (isPastServiceDate(serviceDate)) {
    throw new HttpError(400, 'serviceDate cannot be in the past')
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
    const existing = await query(`SELECT * FROM ${table} WHERE id = $1`, [id])
    return toCamelCase<T>(existing.rows[0])
  }

  const setClauses = keys.map((key, index) => `${toSnakeCase(key)} = $${index + 2}`)
  const timeFields = [
    'departureTime',
    'windowStart',
    'windowEnd',
    'departureBlockStart',
    'departureBlockEnd',
  ]
  const vals = keys.map((key) => {
    const val = data[key]
    if (jsonFields.includes(key)) return JSON.stringify(val)
    if (timeFields.includes(key) && val) {
      return new Date(val as string | number | Date).toISOString()
    }
    return val
  })

  const result = await query(
    `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...vals],
  )
  return toCamelCase<T>(result.rows[0])
}

async function getRouteLocal(id: string): Promise<Route | null> {
  const result = await query('SELECT * FROM routes WHERE id = $1', [id])
  return result.rows[0] ? toCamelCase<Route>(result.rows[0]) : null
}

export async function createPlan(
  clientId: string,
  data: CreatePlanPayload,
): Promise<Plan> {
  await assertUserRole(clientId, 'client')
  assertServiceDateIsNotPast(data.serviceDate)

  const res = await query(
    `
      INSERT INTO plans (
        id, client_id, origin, destination, origin_ward_id, destination_ward_id,
        origin_ward_key, destination_ward_key, origin_province_id,
        destination_province_id, service_date, departure_block_start,
        departure_block_end, passenger_count, publish_mode, notes, status,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
      RETURNING *
    `,
    [
      generateId('plan'),
      clientId,
      JSON.stringify(data.origin),
      JSON.stringify(data.destination),
      data.originWardId,
      data.destinationWardId,
      data.originWardKey,
      data.destinationWardKey,
      data.originProvinceId,
      data.destinationProvinceId,
      data.serviceDate,
      normalizeUtc(data.departureBlockStart),
      normalizeUtc(data.departureBlockEnd),
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
  const result = await query('SELECT * FROM plans WHERE client_id = $1', [clientId])
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
  const result = await query('SELECT * FROM plans WHERE id = $1', [id])
  return result.rows[0] ? mapPlan(result.rows[0]) : null
}

export async function updatePlan(
  id: string,
  data: UpdatePlanPayload,
): Promise<Plan | null> {
  assertServiceDateIsNotPast(data.serviceDate)
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
    const planRes = await tx.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [
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

    const updatedPlan = await tx.query(
      "UPDATE plans SET status = 'canceled' WHERE id = $1 RETURNING *",
      [plan.id],
    )
    const canceledPlan = toCamelCase<Plan>(updatedPlan.rows[0])
    if (!canceledPlan) throw new Error('Failed to cancel plan')
    return canceledPlan
  })
}
