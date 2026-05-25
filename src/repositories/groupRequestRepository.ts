import { query, withTransaction } from '../db/connection'
import { mapRows, parseLocationJson, toCamelCase, toCamelCaseRecord } from '../db/utils'
import { HttpError } from '../http-error'
import { GroupOffer, GroupRequest, Plan } from '../types/entities'
import type { HydratedSentGroupRequest } from '../types/payloads'
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

function mapHydratedGroupRequestRow(row: Record<string, unknown>): HydratedSentGroupRequest {
  const r = toCamelCaseRecord(row)

  const memberPlanIds = r.memberPlanIds
    ? (r.memberPlanIds as string).split(',')
    : []

  const routeOrigin = parseLocationJson(r.routeOrigin)
  const routeDestination = parseLocationJson(r.routeDestination)
  const route =
    routeOrigin && routeDestination && r.routeDeparture
      ? {
          origin: routeOrigin,
          destination: routeDestination,
          departureWindowStartDate: r.routeDeparture as string,
        }
      : null

  const memberCount = r.memberCount != null ? Number(r.memberCount) : null
  const demandGroup =
    memberCount != null
      ? {
          memberCount,
          totalPassengerCount: r.totalPassengerCount != null ? Number(r.totalPassengerCount) : 0,
          earliestDeparture: r.earliestDeparture as string,
          origin: parseLocationJson(r.groupOrigin),
          destination: parseLocationJson(r.groupDestination),
        }
      : null

  return {
    id: r.id as string,
    driverId: r.driverId as string,
    routeId: r.routeId as string,
    demandGroupId: r.demandGroupId as string,
    note: (r.note as string | null) ?? undefined,
    status: r.status as string,
    acceptedClientUserId: (r.acceptedClientUserId as string | null) ?? undefined,
    acceptedPlanId: (r.acceptedPlanId as string | null) ?? undefined,
    clientId: (r.clientId as string | null) ?? undefined,
    createdAt: r.createdAt as string,
    memberPlanIds,
    route,
    demandGroup,
  }
}

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

    const existingRequestRes = await tx.query(
      `
      SELECT * FROM group_requests
      WHERE driver_id = ?
        AND route_id = ?
        AND demand_group_id = ?
        AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
    `,
      [input.driverId, input.routeId, input.demandGroupId],
    )
    let groupRequest = toCamelCase<GroupRequest>(existingRequestRes.rows[0])

    if (!groupRequest) {
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
      groupRequest = toCamelCase<GroupRequest>(requestRes.rows[0])
      if (!groupRequest) throw new Error('Failed to create group request')
    }

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
): Promise<HydratedSentGroupRequest[]> {
  const conditions = ['gr.driver_id = ?']
  const params: string[] = [driverId]

  if (filters.routeId) {
    conditions.push('gr.route_id = ?')
    params.push(filters.routeId)
  }

  const statuses = filters.statuses?.length
    ? filters.statuses
    : filters.status
      ? [filters.status]
      : []

  if (statuses.length > 0) {
    conditions.push(`gr.status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }

  const result = await query(
    `
      SELECT
        gr.*,
        r.origin     AS route_origin,
        r.destination AS route_destination,
        r.departure_window_start_date AS route_departure,
        agg.member_count,
        agg.total_passenger_count,
        agg.earliest_departure,
        agg.member_plan_ids,
        agg.group_origin,
        agg.group_destination
      FROM group_requests gr
      JOIN routes r ON r.id = gr.route_id
      LEFT JOIN (
        SELECT
          go.group_request_id,
          COUNT(*)                                       AS member_count,
          SUM(p.passenger_count)                         AS total_passenger_count,
          MIN(p.departure_window_start_date)             AS earliest_departure,
          GROUP_CONCAT(DISTINCT go.plan_id ORDER BY go.plan_id) AS member_plan_ids,
          MIN(p.origin)                                  AS group_origin,
          MIN(p.destination)                             AS group_destination
        FROM group_offers go
        JOIN plans p ON p.id = go.plan_id
        WHERE go.status IN ('pending', 'accepted')
        GROUP BY go.group_request_id
      ) agg ON agg.group_request_id = gr.id
      WHERE ${conditions.join(' AND ')}
    `,
    params,
  )

  return result.rows.map(mapHydratedGroupRequestRow)
}
