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

export interface ListGroupRequestsByDriverFilters {
  routeId?: string
  statuses?: string[]
  status?: string
}

export type SentGroupRequest = GroupRequest & { memberPlanIds: string[] }

export async function createGroupRequestWithOffers(
  input: CreateGroupRequestTxInput,
): Promise<{ groupRequest: GroupRequest; offers: GroupOffer[] }> {
  return withTransaction(async (tx) => {
    const routeRes = await tx.query('SELECT * FROM routes WHERE id = ? FOR UPDATE', [
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
      VALUES (?, ?, ?, ?, ?, ?, NOW())
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
      const planRes = await tx.query('SELECT * FROM plans WHERE id = ?', [planId])
      const plan = toCamelCase<Plan>(planRes.rows[0])
      if (!plan) continue

      const offerRes = await tx.query(
        `
        INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
      'SELECT * FROM group_requests WHERE id = ? FOR UPDATE',
      [requestId],
    )
    let groupRequest = toCamelCase<GroupRequest>(requestRes.rows[0])
    if (!groupRequest) throw new Error('Group request not found')
    if (groupRequest.status !== 'pending') {
      throw new Error(`Cannot cancel request in status: ${groupRequest.status}`)
    }

    await tx.query(
      "UPDATE group_requests SET status = 'canceled' WHERE id = ?",
      [requestId],
    )
    const updatedRes = await tx.query(
      'SELECT * FROM group_requests WHERE id = ?',
      [requestId],
    )
    groupRequest = toCamelCase<GroupRequest>(updatedRes.rows[0])
    if (!groupRequest) throw new Error('Failed to cancel group request')

    const offerIdsRes = await tx.query(
      "SELECT id FROM group_offers WHERE group_request_id = ? AND status = 'pending'",
      [requestId],
    )
    const offerIds = offerIdsRes.rows.map((r) => String(r.id))
    await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = ? AND status = 'pending'",
      [requestId],
    )
    let closedOffers: GroupOffer[] = []
    if (offerIds.length > 0) {
      const offersRes = await tx.query(
        `SELECT * FROM group_offers WHERE id IN (${offerIds.map(() => '?').join(',')})`,
        offerIds,
      )
      closedOffers = mapRows<GroupOffer>(offersRes.rows)
    }

    return { groupRequest, closedOffers }
  })
}

export async function listGroupRequestsByDriver(
  driverId: string,
  filters: ListGroupRequestsByDriverFilters = {},
): Promise<SentGroupRequest[]> {
  const conditions = ['driver_id = ?']
  const params = [driverId]

  if (filters.routeId) {
    conditions.push('route_id = ?')
    params.push(filters.routeId)
  }

  const statuses = filters.statuses?.length
    ? filters.statuses
    : filters.status
      ? [filters.status]
      : []

  if (statuses.length > 0) {
    conditions.push(`status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }

  const result = await query(
    `
      SELECT
        gr.*,
        covered.member_plan_ids
      FROM group_requests gr
      LEFT JOIN (
        SELECT
          group_request_id,
          route_id,
          GROUP_CONCAT(DISTINCT plan_id ORDER BY plan_id) AS member_plan_ids
        FROM group_offers
        WHERE status IN ('pending', 'accepted')
        GROUP BY group_request_id, route_id
      ) covered
        ON covered.group_request_id = gr.id
        AND covered.route_id = gr.route_id
      WHERE ${conditions.map((condition) => `gr.${condition}`).join(' AND ')}
    `,
    params,
  )
  return result.rows.map((row) => {
    const request = toCamelCase<GroupRequest & { memberPlanIds?: string }>(row)
    if (!request) throw new Error('Failed to map group request')
    const memberPlanIds = request.memberPlanIds
      ? request.memberPlanIds.split(',')
      : []
    return { ...request, memberPlanIds }
  })
}
