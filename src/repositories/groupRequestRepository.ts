import { query, withTransaction } from '../db/connection'
import { mapRows, parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { GroupOffer, GroupRequest, Plan, Route } from '../types/entities'
import { DbQueryExecutor } from './walletRepository'
import { DemandGroupSummary } from '../types/payloads'

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

function mapRoute(row: Record<string, unknown>): Route {
  const route = toCamelCase<Route>(row)
  if (!route) throw new Error('Cannot map null row to Route')
  route.tripPrice = parseNumeric(route.tripPrice)
  route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd)
  return route
}

export interface CreateGroupRequestTxInput {
  driverId: string
  routeId: string
  demandGroupId: string
  note?: string
  memberPlanIds: string[]
}

const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE route_id = $1 AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM route_requests WHERE route_id = $1 AND status = 'accepted'
`

function buildGroupKey(plan: Plan): string {
  const departureDate = plan.departureDate.slice(0, 10)
  const originKey = plan.originWardKey || plan.originWardId
  const destinationKey = plan.destinationWardKey || plan.destinationWardId
  return `${departureDate}|${originKey}|${destinationKey}|${plan.windowStart}`
}

async function checkRouteAvailability(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<boolean> {
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId])
  return result.rowCount === 0
}

export async function deriveDemandGroups(): Promise<DemandGroupSummary[]> {
  const result = await query(
    `
      SELECT *
      FROM plans p
      WHERE p.status = $1
        AND NOT EXISTS (
          SELECT 1
          FROM route_requests sr
          WHERE sr.plan_id = p.id AND sr.status = 'accepted'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM group_offers go
          WHERE go.plan_id = p.id AND go.status = 'accepted'
        )
    `,
    ['published'],
  )

  const grouped = new Map<string, DemandGroupSummary>()
  for (const plan of mapRows<Plan>(result.rows)) {
    const key = buildGroupKey(plan)
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `dg-${key}`,
        departureDate: plan.departureDate,
        originWardId: plan.originWardId,
        destinationWardId: plan.destinationWardId,
        originWardKey: plan.originWardKey,
        destinationWardKey: plan.destinationWardKey,
        originProvinceId: plan.originProvinceId,
        destinationProvinceId: plan.destinationProvinceId,
        windowStart: plan.windowStart,
        windowEnd: plan.windowEnd,
        memberCount: 0,
        totalPassengerCount: 0,
        memberPlanIds: [],
        origin: typeof plan.origin === 'string' ? JSON.parse(plan.origin) : plan.origin,
        destination: typeof plan.destination === 'string' ? JSON.parse(plan.destination) : plan.destination,
        clientIds: [],
      })
    }
    const group = grouped.get(key)
    if (!group) continue
    group.memberCount += 1
    group.totalPassengerCount += plan.passengerCount
    group.memberPlanIds.push(plan.id)
    group.clientIds.push(plan.clientId)
  }

  return [...grouped.values()]
}

export async function getDemandGroup(groupId: string): Promise<DemandGroupSummary | null> {
  const groups = await deriveDemandGroups()
  return groups.find((group) => group.id === groupId) || null
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
