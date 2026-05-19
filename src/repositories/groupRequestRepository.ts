import { query, withTransaction } from '../db/connection'
import { mapRows, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { GroupOffer, GroupRequest, Plan } from '../types/entities'
import { checkRouteAvailability, mapRoute } from './routeAvailabilityRepository'

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

export interface CreateGroupRequestTxInput {
  driverId: string
  routeId: string
  demandGroupId: string
  note?: string
  memberPlanIds: string[]
}

export interface CancelGroupRequestTxResult {
  groupRequest: GroupRequest
  closedOffers: GroupOffer[]
}

export async function createGroupRequestWithOffers(
  input: CreateGroupRequestTxInput,
): Promise<{ groupRequest: GroupRequest; offers: GroupOffer[] }> {
  return withTransaction(async (tx) => {
    const routeRes = await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [
      input.routeId,
    ])
    const route = routeRes.rows[0] ? mapRoute(routeRes.rows[0]) : null
    if (!route) throw new HttpError(404, 'Route not found')

    if (!(await checkRouteAvailability(tx, input.routeId))) {
      throw new HttpError(
        409,
        'Route is not available — already has an accepted client',
      )
    }

    const groupRequestId = generateId('greq')
    const requestRes = await tx.query(
      `
      INSERT INTO group_requests (id, driver_id, route_id, demand_group_id, note, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `,
      [
        groupRequestId,
        input.driverId,
        input.routeId,
        input.demandGroupId,
        input.note || '',
        'pending',
      ],
    )
    const groupRequest = toCamelCase<GroupRequest>(requestRes.rows[0])
    if (!groupRequest) throw new Error('Failed to create group request')

    const offers: GroupOffer[] = []
    for (const planId of input.memberPlanIds) {
      const planRes = await tx.query('SELECT * FROM plans WHERE id = $1', [planId])
      const plan = toCamelCase<Plan>(planRes.rows[0])
      if (!plan) continue

      const offerRes = await tx.query(
        `
        INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `,
        [
          generateId('goffer'),
          groupRequest.id,
          input.routeId,
          input.driverId,
          plan.clientId,
          planId,
          route.tripPrice,
          'pending',
        ],
      )
      const offer = toCamelCase<GroupOffer>(offerRes.rows[0])
      if (offer) offers.push(offer)
    }

    return { groupRequest, offers }
  })
}

export async function cancelGroupRequestWithOffers(
  requestId: string,
): Promise<CancelGroupRequestTxResult> {
  return withTransaction(async (tx) => {
    const requestRes = await tx.query(
      'SELECT * FROM group_requests WHERE id = $1 FOR UPDATE',
      [requestId],
    )
    let groupRequest = toCamelCase<GroupRequest>(requestRes.rows[0])
    if (!groupRequest) throw new Error('Group request not found')
    if (groupRequest.status !== 'pending') {
      throw new Error(`Cannot cancel request in status: ${groupRequest.status}`)
    }

    const updatedRes = await tx.query(
      "UPDATE group_requests SET status = 'canceled' WHERE id = $1 RETURNING *",
      [requestId],
    )
    groupRequest = toCamelCase<GroupRequest>(updatedRes.rows[0])
    if (!groupRequest) throw new Error('Failed to cancel group request')

    const offersRes = await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND status = 'pending' RETURNING *",
      [requestId],
    )

    return { groupRequest, closedOffers: mapRows<GroupOffer>(offersRes.rows) }
  })
}

export async function listGroupRequestsByDriver(
  driverId: string,
): Promise<GroupRequest[]> {
  const result = await query(
    'SELECT * FROM group_requests WHERE driver_id = $1',
    [driverId],
  )
  return mapRows<GroupRequest>(result.rows)
}
