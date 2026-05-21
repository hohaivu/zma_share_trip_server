import { HttpError } from '../http-error'
import { GroupOffer, GroupRequest } from '../types/entities'
import { query } from '../db/connection'
import { toCamelCase } from '../db/utils'
import { routePlanWindowsOverlap } from '../matching/filters/blockOverlapFilter'
import { demandGroupIdFor } from '../repositories/demandGroupRepository'
import * as groupRequestRepository from '../repositories/groupRequestRepository'
import { emitNotification } from './notificationService'
import { assertUserRole } from './userService'

export interface GroupRequestService {
  createGroupRequest(
    driverId: string,
    routeId: string,
    demandGroupId: string,
    memberPlanIds: string[],
    note?: string,
  ): Promise<{ groupRequest: GroupRequest; offers: GroupOffer[] }>
  listGroupRequestsByDriver(driverId: string): Promise<GroupRequest[]>
  cancelGroupRequest(requestId: string): Promise<GroupRequest>
}

interface RouteWindowAndIdentity {
  departureWindowStartDate: string
  departureWindowEndDate: string
}

interface PlanValidationRow {
  id: string
  status: string
  originWardId: string
  originProvinceId: string
  destinationWardId: string
  destinationProvinceId: string
  departureWindowStartDate: string
  departureWindowEndDate: string
  hasAcceptedRouteRequest: number | boolean
  hasAcceptedGroupOffer: number | boolean
  hasPendingRouteRequestForRoute: number | boolean
  hasActiveGroupOfferForRoute: number | boolean
}

async function validateMemberPlanIds(
  routeId: string,
  demandGroupId: string,
  memberPlanIds: string[],
): Promise<string[]> {
  const routeRes = await query(
    'SELECT departure_window_start_date, departure_window_end_date FROM routes WHERE id = ?',
    [routeId],
  )
  const route = toCamelCase<RouteWindowAndIdentity>(routeRes.rows[0])
  if (!route) throw new HttpError(404, 'Route not found')

  const stale = new Set<string>()
  const placeholders = memberPlanIds.map(() => '?').join(',')
  const plansRes = await query(
    `
      SELECT
        p.*,
        EXISTS (
          SELECT 1 FROM route_requests rr
          WHERE rr.plan_id = p.id AND rr.status = 'accepted'
        ) AS has_accepted_route_request,
        EXISTS (
          SELECT 1 FROM group_offers go
          WHERE go.plan_id = p.id AND go.status = 'accepted'
        ) AS has_accepted_group_offer,
        EXISTS (
          SELECT 1 FROM route_requests rr
          WHERE rr.plan_id = p.id AND rr.route_id = ? AND rr.status = 'pending'
        ) AS has_pending_route_request_for_route,
        EXISTS (
          SELECT 1 FROM group_offers go
          WHERE go.plan_id = p.id AND go.route_id = ? AND go.status IN ('pending', 'accepted')
        ) AS has_active_group_offer_for_route
      FROM plans p
      WHERE p.id IN (${placeholders})
    `,
    [routeId, routeId, ...memberPlanIds],
  )
  const plansById = new Map<string, PlanValidationRow>()
  for (const row of plansRes.rows) {
    const plan = toCamelCase<PlanValidationRow>(row)
    if (plan) plansById.set(plan.id, plan)
  }

  for (const planId of memberPlanIds) {
    const plan = plansById.get(planId)
    if (!plan) {
      stale.add(planId)
      continue
    }

    const isStale =
      plan.status !== 'published' ||
      Boolean(plan.hasAcceptedRouteRequest) ||
      Boolean(plan.hasAcceptedGroupOffer) ||
      Boolean(plan.hasPendingRouteRequestForRoute) ||
      Boolean(plan.hasActiveGroupOfferForRoute) ||
      demandGroupIdFor(plan) !== demandGroupId ||
      !routePlanWindowsOverlap(
        route.departureWindowStartDate,
        route.departureWindowEndDate,
        plan.departureWindowStartDate,
        plan.departureWindowEndDate,
      )

    if (isStale) stale.add(planId)
  }

  return [...stale]
}

export const groupRequestService: GroupRequestService = {
  async createGroupRequest(driverId, routeId, demandGroupId, memberPlanIds, note) {
    await assertUserRole(driverId, 'driver')

    if (memberPlanIds.length === 0) {
      throw HttpError.withSafeDetails(409, 'Demand group members are stale', {
        staleMemberPlanIds: [],
      })
    }

    const staleMemberPlanIds = await validateMemberPlanIds(
      routeId,
      demandGroupId,
      memberPlanIds,
    )
    if (staleMemberPlanIds.length > 0) {
      throw HttpError.withSafeDetails(409, 'Demand group members are stale', {
        staleMemberPlanIds,
      })
    }

    const result = await groupRequestRepository.createGroupRequestWithOffers({
      driverId,
      routeId,
      demandGroupId,
      note,
      memberPlanIds,
    })

    for (const offer of result.offers) {
      emitNotification('group_offer_received', offer.clientId, {
        groupOfferId: offer.id,
        groupRequestId: result.groupRequest.id,
        driverId,
        routeId,
      })
    }

    return result
  },

  async listGroupRequestsByDriver(driverId) {
    await assertUserRole(driverId, 'driver')
    return groupRequestRepository.listGroupRequestsByDriver(driverId)
  },

  async cancelGroupRequest(requestId) {
    const result = await groupRequestRepository.cancelGroupRequestWithOffers(requestId)

    for (const offer of result.closedOffers) {
      emitNotification('sibling_offer_closed', offer.clientId, {
        groupOfferId: offer.id,
        reason: 'group_request_canceled',
      })
    }

    emitNotification('group_request_canceled', result.groupRequest.driverId, {
      groupRequestId: requestId,
    })

    return result.groupRequest
  },
}

export const createGroupRequest = groupRequestService.createGroupRequest
export const listGroupRequestsByDriver = groupRequestService.listGroupRequestsByDriver
export const cancelGroupRequest = groupRequestService.cancelGroupRequest
