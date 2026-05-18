import { query, withTransaction } from '../db/connection'
import { mapRows, parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import {
  GroupOffer,
  GroupRequest,
  GroupRequestCandidateResult,
  GroupRequestCreateResult,
  GroupRequestWithOffers,
  Plan,
  Route,
  RouteRequest,
} from '../types/entities'
import { chargeRouteFeeTx, DbQueryExecutor } from './walletRepository'
import { DemandGroupSummary } from '../types/payloads'
import { assertRoutePlanEndsInFutureTx, expirePendingMatchesTx } from './requestLifecycleRepository'

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
  targetPlanId?: string
}

const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE (route_id = $1 OR plan_id = $2) AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM route_requests WHERE (route_id = $1 OR plan_id = $2) AND status = 'accepted'
`

function normalizeUtc(value?: string | Date | null): string | undefined {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function buildGroupKey(plan: Plan): string {
  const serviceDate =
    typeof plan.serviceDate === 'string' && plan.serviceDate.includes('T')
      ? new Date(plan.serviceDate).toISOString().split('T')[0]
      : plan.serviceDate
  const departureBlockStart = normalizeUtc(plan.departureBlockStart)

  const pickupKey = plan.pickupWardKey || plan.pickupWardId
  const dropoffKey = plan.dropoffWardKey || plan.dropoffWardId
  return `${serviceDate}|${pickupKey}|${dropoffKey}|${departureBlockStart}`
}

function buildRouteScopedGroupKey(plan: Plan): string {
  const serviceDate =
    typeof plan.serviceDate === 'string' && plan.serviceDate.includes('T')
      ? new Date(plan.serviceDate).toISOString().split('T')[0]
      : plan.serviceDate

  const pickupKey = plan.pickupWardKey || plan.pickupWardId
  const dropoffKey = plan.dropoffWardKey || plan.dropoffWardId
  return `${serviceDate}|${pickupKey}|${dropoffKey}`
}

function getRouteSoftWindow(route: Route): { start: Date; end: Date } {
  const bufferMs = 30 * 60 * 1000
  const hardStart = route.windowStart || route.departureTime
  const hardEnd = route.windowEnd || route.departureTime
  return {
    start: new Date(new Date(hardStart).getTime() - bufferMs),
    end: new Date(new Date(hardEnd).getTime() + bufferMs),
  }
}

function planOverlapsRouteSoftWindow(plan: Plan, route: Route): boolean {
  const routeSoftWindow = getRouteSoftWindow(route)
  return (
    new Date(plan.departureBlockStart).getTime() < routeSoftWindow.end.getTime() &&
    routeSoftWindow.start.getTime() < new Date(plan.departureBlockEnd).getTime()
  )
}

function addPlanToDemandGroup(
  grouped: Map<string, DemandGroupSummary>,
  key: string,
  plan: Plan,
): void {
  if (!grouped.has(key)) {
    grouped.set(key, {
      id: `dg-${key}`,
      serviceDate: plan.serviceDate,
      pickupWardId: plan.pickupWardId,
      dropoffWardId: plan.dropoffWardId,
      pickupWardKey: plan.pickupWardKey,
      dropoffWardKey: plan.dropoffWardKey,
      pickupProvinceId: plan.pickupProvinceId,
      dropoffProvinceId: plan.dropoffProvinceId,
      departureBlockStart: plan.departureBlockStart,
      departureBlockEnd: plan.departureBlockEnd,
      memberCount: 0,
      totalPassengerCount: 0,
      memberPlanIds: [],
      pickup: typeof plan.pickup === 'string' ? JSON.parse(plan.pickup) : plan.pickup,
      dropoff: typeof plan.dropoff === 'string' ? JSON.parse(plan.dropoff) : plan.dropoff,
      clientIds: [],
    })
  }
  const group = grouped.get(key)
  if (!group || group.memberPlanIds.includes(plan.id)) return
  group.memberCount += 1
  group.totalPassengerCount += plan.passengerCount
  group.memberPlanIds.push(plan.id)
  group.clientIds.push(plan.clientId)
  if (new Date(plan.departureBlockStart) < new Date(group.departureBlockStart)) {
    group.departureBlockStart = plan.departureBlockStart
  }
  if (new Date(plan.departureBlockEnd) > new Date(group.departureBlockEnd)) {
    group.departureBlockEnd = plan.departureBlockEnd
  }
}

async function listAvailablePublishedPlans(): Promise<Plan[]> {
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
        AND NOW() < p.departure_block_end
        AND NOT EXISTS (
          SELECT 1
          FROM group_offers go
          WHERE go.plan_id = p.id AND go.status = 'accepted'
        )
    `,
    ['published'],
  )
  return mapRows<Plan>(result.rows)
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    deduped.push(value)
  }
  return deduped
}

async function checkRouteAvailability(
  executor: DbQueryExecutor,
  routeId: string,
  planId?: string,
): Promise<boolean> {
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId, planId ?? null])
  return result.rowCount === 0
}

export async function deriveDemandGroups(): Promise<DemandGroupSummary[]> {
  await expirePendingMatchesTx({ query })
  const grouped = new Map<string, DemandGroupSummary>()
  for (const plan of await listAvailablePublishedPlans()) {
    addPlanToDemandGroup(grouped, buildGroupKey(plan), plan)
  }

  return [...grouped.values()]
}

export async function deriveDemandGroupsForRoute(route: Route): Promise<DemandGroupSummary[]> {
  await expirePendingMatchesTx({ query })
  const grouped = new Map<string, DemandGroupSummary>()
  for (const plan of await listAvailablePublishedPlans()) {
    if (!planOverlapsRouteSoftWindow(plan, route)) continue
    addPlanToDemandGroup(grouped, buildRouteScopedGroupKey(plan), plan)
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
): Promise<GroupRequestCreateResult> {
  const memberPlanIds = dedupePreservingOrder(input.memberPlanIds)
  const memberPlanOrder = new Map(memberPlanIds.map((planId, index) => [planId, index]))

  return withTransaction(async (tx) => {
    await expirePendingMatchesTx(tx)
    const routeRes = await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [
      input.routeId,
    ])
    const route = routeRes.rows[0] ? mapRoute(routeRes.rows[0]) : null
    if (!route) throw new HttpError(404, 'Route not found')
    if (route.driverId !== input.driverId) throw new HttpError(403, 'Route does not belong to driver')

    if (route.status !== 'published') {
      throw HttpError.withSafeDetails(409, `Cannot create group request for route in status: ${route.status}`, {
        outcome: 'no_new_requests',
        createdCount: 0,
        skippedCount: memberPlanIds.length,
        refreshHint: 'no_new_candidates',
        candidateResults: memberPlanIds.map((planId) => ({
          planId,
          status: 'skipped_unavailable' as const,
        })),
      })
    }

    const routeAvailable = await checkRouteAvailability(tx, input.routeId)
    const routeStillOpen = new Date(route.windowEnd).getTime() > Date.now()
    const offers: GroupOffer[] = []
    const candidateResults: GroupRequestCandidateResult[] = []
    let eligiblePlans: Plan[] = []
    const eligibleClientIds = new Set<string>()
    let groupRequest: GroupRequest | undefined

    for (const planId of memberPlanIds) {
      const planRes = await tx.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [planId])
      const plan = toCamelCase<Plan>(planRes.rows[0])
      if (!plan || plan.status !== 'published') {
        candidateResults.push({ planId, status: 'skipped_unavailable' })
        continue
      }
      if (!routeStillOpen || new Date(plan.departureBlockEnd).getTime() <= Date.now()) {
        candidateResults.push({ planId, status: 'skipped_unavailable' })
        continue
      }

      if (eligibleClientIds.has(plan.clientId)) {
        candidateResults.push({ planId, status: 'skipped_existing' })
        continue
      }

      const existingOfferRes = await tx.query(
        `
          SELECT status FROM group_offers
          WHERE route_id = $1 AND client_id = $2 AND status IN ('pending', 'accepted')
          LIMIT 1
        `,
        [input.routeId, plan.clientId],
      )
      if ((existingOfferRes.rowCount || 0) > 0) {
        candidateResults.push({ planId, status: 'skipped_existing' })
        continue
      }

      if (!routeAvailable) {
        candidateResults.push({ planId, status: 'skipped_unavailable' })
        continue
      }

      const existingRouteRequestRes = await tx.query(
        `
          SELECT status FROM route_requests
          WHERE route_id = $1 AND plan_id = $2 AND status IN ('pending', 'accepted')
          LIMIT 1
        `,
        [input.routeId, planId],
      )
      if ((existingRouteRequestRes.rowCount || 0) > 0) {
        const status = existingRouteRequestRes.rows[0]?.status
        if (status === 'pending') {
          eligiblePlans.push(plan)
          eligibleClientIds.add(plan.clientId)
          continue
        }
        candidateResults.push({
          planId,
          status: status === 'accepted' ? 'skipped_matched' : 'skipped_existing',
        })
        continue
      }

      const matchedPlanRes = await tx.query(
        `
          SELECT 1 FROM group_offers WHERE plan_id = $1 AND status = 'accepted'
          UNION ALL
          SELECT 1 FROM route_requests WHERE plan_id = $1 AND status = 'accepted'
          LIMIT 1
        `,
        [planId],
      )
      if ((matchedPlanRes.rowCount || 0) > 0) {
        candidateResults.push({ planId, status: 'skipped_matched' })
        continue
      }

      eligiblePlans.push(plan)
      eligibleClientIds.add(plan.clientId)
    }

    const eligiblePlanIds = eligiblePlans.map((plan) => plan.id)

    if (eligiblePlanIds.length > 0) {
      const reciprocalRes = await tx.query(
        `
          SELECT * FROM route_requests
          WHERE route_id = $1
            AND plan_id = ANY($2)
            AND status = 'pending'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
          FOR UPDATE
        `,
        [input.routeId, eligiblePlanIds],
      )
      const matchedRouteRequest = toCamelCase<RouteRequest>(reciprocalRes.rows[0])

      if (matchedRouteRequest) {
        const matchedPlan = eligiblePlans.find((plan) => plan.id === matchedRouteRequest.planId)
        if (!matchedPlan) throw new Error('Matched reciprocal request plan was not eligible')

        const existingParentRes = await tx.query(
          `
            SELECT * FROM group_requests
            WHERE route_id = $1 AND demand_group_id = $2 AND driver_id = $3 AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
          `,
          [input.routeId, input.demandGroupId, input.driverId],
        )
        groupRequest = toCamelCase<GroupRequest>(existingParentRes.rows[0]) || undefined

        if (!groupRequest) {
          const requestRes = await tx.query(
            `
              INSERT INTO group_requests (id, driver_id, route_id, demand_group_id, note, status, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, NOW())
              RETURNING *
            `,
            [
              generateId('greq'),
              input.driverId,
              input.routeId,
              input.demandGroupId,
              input.note || '',
              'pending',
            ],
          )
          groupRequest = toCamelCase<GroupRequest>(requestRes.rows[0]) || undefined
          if (!groupRequest) throw new Error('Failed to create group request')
        }

        if (!(await checkRouteAvailability(tx, input.routeId, matchedRouteRequest.planId))) {
          throw new HttpError(409, 'Route or plan is no longer available — another client was accepted first')
        }
        await assertRoutePlanEndsInFutureTx(tx, input.routeId, matchedRouteRequest.planId, 'Route or plan has expired')

        const offerRes = await tx.query(
          `
            INSERT INTO group_offers (
              id, group_request_id, route_id, driver_id, client_id, plan_id,
              trip_price, status, source_route_request_id, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted', $8, NOW())
            RETURNING *
          `,
          [
            generateId('goffer'),
            groupRequest.id,
            input.routeId,
            input.driverId,
            matchedRouteRequest.clientId,
            matchedRouteRequest.planId,
            route.tripPrice,
            matchedRouteRequest.id,
          ],
        )
        const matchedOffer = toCamelCase<GroupOffer>(offerRes.rows[0])
        if (!matchedOffer) throw new Error('Failed to create matched group offer')

        const updatedRouteRequestRes = await tx.query(
          `
            UPDATE route_requests
            SET status = 'accepted', accepted_group_offer_id = $1
            WHERE id = $2
              AND status = 'pending'
            RETURNING *
          `,
          [matchedOffer.id, matchedRouteRequest.id],
        )
        const updatedRouteRequest = toCamelCase<RouteRequest>(updatedRouteRequestRes.rows[0])
        if (!updatedRouteRequest) {
          throw new HttpError(409, 'Matched route request is no longer pending')
        }

        const routeUpdateRes = await tx.query("UPDATE routes SET status = 'matched' WHERE id = $1 AND status = 'published'", [input.routeId])
        if (routeUpdateRes.rowCount === 0) throw new HttpError(409, 'Route is no longer published')
        const planUpdateRes = await tx.query("UPDATE plans SET status = 'matched' WHERE id = $1 AND status = 'published'", [
          matchedRouteRequest.planId,
        ])
        if (planUpdateRes.rowCount === 0) throw new HttpError(409, 'Plan is no longer published')
        await chargeRouteFeeTx(tx, route, mapRoute, {
          description: 'Route fee charged on reciprocal group request match',
        })
        await tx.query(
          "UPDATE group_offers SET status = 'closed' WHERE (route_id = $1 OR plan_id = $3) AND id != $2 AND status = 'pending'",
          [input.routeId, matchedOffer.id, matchedOffer.planId],
        )
        await tx.query(
          "UPDATE route_requests SET status = 'closed' WHERE (route_id = $1 OR plan_id = $3) AND id != $2 AND status = 'pending'",
          [input.routeId, matchedRouteRequest.id, matchedOffer.planId],
        )

        const updatedParentRes = await tx.query(
          `
            UPDATE group_requests
            SET status = 'accepted', accepted_client_user_id = $1, accepted_plan_id = $2, client_id = $1
            WHERE id = $3
            RETURNING *
          `,
          [matchedOffer.clientId, matchedOffer.planId, groupRequest.id],
        )
        groupRequest = toCamelCase<GroupRequest>(updatedParentRes.rows[0]) || groupRequest

        return {
          groupRequest,
          offers: [matchedOffer],
          outcome: 'matched',
          matchedOffer,
          matchedRouteRequest: updatedRouteRequest,
          match: {
            kind: 'reciprocal_request',
            sourceRouteRequestId: updatedRouteRequest.id,
            acceptedGroupOfferId: matchedOffer.id,
            routeId: input.routeId,
            planId: matchedOffer.planId,
            clientId: matchedOffer.clientId,
            driverId: input.driverId,
          },
          createdCount: 1,
          skippedCount: 0,
          refreshHint: 'none',
          candidateResults: [{ planId: matchedOffer.planId, status: 'matched' }],
        }
      }
    }

    if (eligiblePlans.length === 0) {
      const existingParentRes = await tx.query(
        `
          SELECT * FROM group_requests
          WHERE route_id = $1 AND demand_group_id = $2 AND driver_id = $3 AND status = 'pending'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [input.routeId, input.demandGroupId, input.driverId],
      )
      groupRequest = toCamelCase<GroupRequest>(existingParentRes.rows[0]) || undefined
      if (!groupRequest) {
        const createdCount = 0
        const skippedCount = candidateResults.length
        throw HttpError.withSafeDetails(409, 'No new group requests available', {
          outcome: 'no_new_requests',
          createdCount,
          skippedCount,
          refreshHint: 'no_new_candidates',
          candidateResults,
        })
      }
    }

    if (!groupRequest) {
      const targetPlan = input.targetPlanId
        ? eligiblePlans.find((plan) => plan.id === input.targetPlanId)
        : undefined
      const requestRes = await tx.query(
        `
        INSERT INTO group_requests (
          id, driver_id, route_id, demand_group_id, note, status,
          client_id, accepted_plan_id, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `,
        [
          generateId('greq'),
          input.driverId,
          input.routeId,
          input.demandGroupId,
          input.note || '',
          'pending',
          targetPlan?.clientId ?? null,
          targetPlan?.id ?? null,
        ],
      )
      groupRequest = toCamelCase<GroupRequest>(requestRes.rows[0]) || undefined
      if (!groupRequest) throw new Error('Failed to create group request')
    }

    for (const plan of eligiblePlans) {
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
          plan.id,
          route.tripPrice,
          'pending',
        ],
      )
      const offer = toCamelCase<GroupOffer>(offerRes.rows[0])
      if (offer) {
        offers.push(offer)
        candidateResults.push({ planId: plan.id, status: 'created' })
      }
    }

    candidateResults.sort(
      (left, right) =>
        (memberPlanOrder.get(left.planId) ?? Number.MAX_SAFE_INTEGER) -
        (memberPlanOrder.get(right.planId) ?? Number.MAX_SAFE_INTEGER),
    )

    const createdCount = offers.length
    const skippedCount = candidateResults.length - createdCount
    if (createdCount === 0) {
      throw HttpError.withSafeDetails(409, 'No new group requests available', {
        outcome: 'no_new_requests',
        createdCount,
        skippedCount,
        refreshHint: 'no_new_candidates',
        candidateResults,
      })
    }

    return {
      groupRequest,
      offers,
      outcome: createdCount > 0 ? 'created' : 'no_new_requests',
      createdCount,
      skippedCount,
      refreshHint: createdCount > 0 ? 'none' : 'no_new_candidates',
      candidateResults,
    }
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
): Promise<GroupRequestWithOffers[]> {
  const requestsRes = await query(
    'SELECT * FROM group_requests WHERE driver_id = $1',
    [driverId],
  )
  const requests = mapRows<GroupRequest>(requestsRes.rows)
  if (requests.length === 0) return []

  const ids = requests.map((r) => r.id)
  const offersRes = await query(
    'SELECT * FROM group_offers WHERE group_request_id = ANY($1)',
    [ids],
  )
  const offers = mapRows<GroupOffer>(offersRes.rows)
  const byRequestId = new Map<string, GroupOffer[]>()
  for (const offer of offers) {
    const list = byRequestId.get(offer.groupRequestId) ?? []
    list.push(offer)
    byRequestId.set(offer.groupRequestId, list)
  }
  return requests.map((req) => ({ ...req, offers: byRequestId.get(req.id) ?? [] }))
}
