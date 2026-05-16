// Error contract decision (ALI-57 Wave 4): services throw HttpError directly.
// Moving to domain errors mapped by controller middleware is deferred — it would
// require a new error type hierarchy and middleware changes across all controllers.
// Revisit when a controller error-mapping layer is introduced.

import { withTransaction } from '../db/connection'
import { toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { journeyRepository, JourneyRepository, mapRoute } from '../repositories/journeyRepository'
import {
  findAcceptedPlanMatchTx,
  findAcceptedRouteMatchTx,
} from '../repositories/tripListRepository'
import {
  loadRouteForWalletTx,
  refundRouteFeeTx,
  releaseRouteFeeTx,
  type DbQueryExecutor,
} from '../repositories/walletRepository'
import { GroupOffer, Plan, Route, RouteRequest } from '../types/entities'
import { JourneyAcceptedState, JourneySummary } from '../types/payloads'

type AcceptedSearchSummary = Extract<
  JourneyAcceptedState,
  { type: 'route_request' }
>
type AcceptedGroupSummary = Extract<
  JourneyAcceptedState,
  { type: 'group_offer' }
>

export function buildJourneySummary<T extends Route | Plan>(
  entity: T,
  accepted: JourneyAcceptedState | null,
  reviewEligibility?: JourneySummary['reviewEligibility'],
): T & Pick<JourneySummary, 'accepted' | 'reviewEligibility'> {
  return { ...entity, accepted, ...(reviewEligibility ? { reviewEligibility } : {}) }
}

async function findAccepted(
  getSearchReqs: () => Promise<RouteRequest[]>,
  getGroupOffers: () => Promise<GroupOffer[]>,
  planId: string | null,
  buildSearchAccepted: (
    accepted: RouteRequest,
  ) => Promise<AcceptedSearchSummary>,
  buildGroupAccepted: (accepted: GroupOffer) => Promise<AcceptedGroupSummary>,
): Promise<JourneyAcceptedState | null> {
  const searchReqs = await getSearchReqs()
  const acceptedSearch = searchReqs.find(
    (r) => r.status === 'accepted' && (planId === null || r.planId === planId),
  )
  if (acceptedSearch) {
    return buildSearchAccepted(acceptedSearch)
  }

  const groupOffers = await getGroupOffers()
  const acceptedOffer = groupOffers.find(
    (o) => o.status === 'accepted' && (planId === null || o.planId === planId),
  )
  if (acceptedOffer) {
    return buildGroupAccepted(acceptedOffer)
  }

  return null
}

type AcceptedJourneyMatch = Awaited<ReturnType<typeof findAcceptedRouteMatchTx>>

async function unwindRouteFeeOnMatchedCancel(
  executor: DbQueryExecutor,
  route: Route,
): Promise<Route> {
  switch (route.walletFeeStatus) {
    case 'charged':
      return refundRouteFeeTx(executor, route, mapRoute, {
        description: 'Route fee refunded on trip cancel',
      })
    case 'reserved':
      return releaseRouteFeeTx(executor, route, mapRoute, {
        description: 'Route fee released on trip cancel',
      })
    case 'refunded':
    case 'released':
    case 'none':
      return route
    default:
      throw new HttpError(
        409,
        `Cannot cancel matched route in fee state: ${route.walletFeeStatus}`,
      )
  }
}

async function cancelAcceptedJourneyMatchTx(
  executor: DbQueryExecutor,
  accepted: AcceptedJourneyMatch,
): Promise<void> {
  if (!accepted) return
  if (accepted.kind === 'route_request') {
    await executor.query("UPDATE route_requests SET status = 'canceled' WHERE id = $1", [accepted.request.id])
  } else {
    await executor.query("UPDATE group_offers SET status = 'canceled' WHERE id = $1", [accepted.offer.id])
  }
}

async function cancelRouteTripTx(executor: DbQueryExecutor, route: Route): Promise<Route> {
  if (route.status === 'canceled') return route
  const accepted = await findAcceptedRouteMatchTx(executor, route.id)
  if (accepted) {
    route = await unwindRouteFeeOnMatchedCancel(executor, route)
    await cancelAcceptedJourneyMatchTx(executor, accepted)
  } else if (route.walletFeeStatus === 'reserved') {
    route = await releaseRouteFeeTx(executor, route, mapRoute, { description: 'Route fee released on route cancel' })
  } else if (route.walletFeeStatus === 'charged') {
    throw new HttpError(409, 'Cannot cancel an unmatched route after the fee has already been charged')
  }
  const updatedRoute = await executor.query("UPDATE routes SET status = 'canceled' WHERE id = $1 RETURNING *", [route.id])
  return mapRoute(updatedRoute.rows[0])
}

async function cancelPlanTripTx(executor: DbQueryExecutor, plan: Plan): Promise<Plan> {
  if (plan.status === 'canceled') return plan
  const accepted = await findAcceptedPlanMatchTx(executor, plan)
  if (accepted) {
    const routeId = accepted.kind === 'route_request' ? accepted.request.routeId : accepted.offer.routeId
    const route = await loadRouteForWalletTx(executor, routeId, mapRoute)
    await unwindRouteFeeOnMatchedCancel(executor, route)
    await cancelAcceptedJourneyMatchTx(executor, accepted)
  }
  const updatedPlan = await executor.query("UPDATE plans SET status = 'canceled' WHERE id = $1 RETURNING *", [plan.id])
  const canceledPlan = toCamelCase<Plan>(updatedPlan.rows[0])
  if (!canceledPlan) throw new Error('Failed to cancel plan')
  return canceledPlan
}

function createJourneyService(repository: JourneyRepository) {
  async function findAcceptedForRoute(
    route: Route,
  ): Promise<JourneyAcceptedState | null> {
    if (route.status === 'canceled') {
      return null
    }
    return findAccepted(
      () => repository.listRouteRequestsByRoute(route.id),
      () => repository.listGroupOffersByRoute(route.id),
      null,
      async (accepted) => ({
        type: 'route_request',
        requestId: accepted.id,
        matchedUser: (await repository.getUser(accepted.clientId)) || null,
        plan: accepted.planId ? await repository.getPlan(accepted.planId) : null,
        tripPrice: accepted.tripPrice ?? 0,
        status: accepted.status,
      }),
      async (accepted) => ({
        type: 'group_offer',
        offerId: accepted.id,
        matchedUser: (await repository.getUser(accepted.clientId)) || null,
        route: await repository.getRoute(accepted.routeId),
        tripPrice: accepted.tripPrice,
        status: accepted.status,
      }),
    )
  }

  async function findAcceptedForPlan(
    plan: Plan,
  ): Promise<JourneyAcceptedState | null> {
    if (plan.status === 'canceled') {
      return null
    }
    return findAccepted(
      () => repository.listRouteRequestsByPlan(plan.id),
      () => repository.listGroupOffersByPlan(plan.id),
      plan.id,
      async (accepted) => ({
        type: 'route_request',
        requestId: accepted.id,
        matchedUser: (await repository.getUser(accepted.driverId)) || null,
        plan: accepted.planId ? await repository.getPlan(accepted.planId) : null,
        tripPrice: accepted.tripPrice ?? 0,
        status: accepted.status,
      }),
      async (accepted) => ({
        type: 'group_offer',
        offerId: accepted.id,
        matchedUser: (await repository.getUser(accepted.driverId)) || null,
        route: (await repository.getRoute(accepted.routeId)) || null,
        tripPrice: accepted.tripPrice,
        status: accepted.status,
      }),
    )
  }

  return {
    async cancelTrip(tripId: string): Promise<Route | Plan> {
      return withTransaction(async (tx) => {
        const routeRes = await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [tripId])
        if (routeRes.rows[0]) return cancelRouteTripTx(tx, mapRoute(routeRes.rows[0]))
        const planRes = await tx.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [tripId])
        const plan = toCamelCase<Plan>(planRes.rows[0])
        if (plan) return cancelPlanTripTx(tx, plan)
        throw new HttpError(404, 'Trip not found')
      })
    },

    async completeTrip(tripId: string): Promise<Route | Plan> {
      return withTransaction(async (tx) => {
        const completedAt = new Date()
        const routeRes = await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [tripId])
        const route = routeRes.rows[0] ? mapRoute(routeRes.rows[0]) : null
        if (route) {
          const accepted = await findAcceptedRouteMatchTx(tx, route.id)
          const updatedRouteRes = await tx.query("UPDATE routes SET status = 'completed', completed_at = $2 WHERE id = $1 RETURNING *", [route.id, completedAt])
          if (accepted?.kind === 'route_request' && accepted.request.planId) {
            await tx.query("UPDATE plans SET status = 'completed', completed_at = $2 WHERE id = $1", [accepted.request.planId, completedAt])
          }
          if (accepted?.kind === 'group_offer' && accepted.offer.planId) {
            await tx.query("UPDATE plans SET status = 'completed', completed_at = $2 WHERE id = $1", [accepted.offer.planId, completedAt])
          }
          return mapRoute(updatedRouteRes.rows[0])
        }
        const planRes = await tx.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [tripId])
        const plan = planRes.rows[0] ? toCamelCase<Plan>(planRes.rows[0]) : null
        if (plan) {
          const accepted = await findAcceptedPlanMatchTx(tx, plan)
          const updatedPlanRes = await tx.query("UPDATE plans SET status = 'completed', completed_at = $2 WHERE id = $1 RETURNING *", [plan.id, completedAt])
          if (accepted?.kind === 'route_request') {
            await tx.query("UPDATE routes SET status = 'completed', completed_at = $2 WHERE id = $1", [accepted.request.routeId, completedAt])
          }
          if (accepted?.kind === 'group_offer') {
            await tx.query("UPDATE routes SET status = 'completed', completed_at = $2 WHERE id = $1", [accepted.offer.routeId, completedAt])
          }
          const updatedPlan = toCamelCase<Plan>(updatedPlanRes.rows[0])
          if (!updatedPlan) throw new Error('Failed to complete plan')
          return updatedPlan
        }
        throw new HttpError(404, 'Trip not found')
      })
    },

    listSavedLocations: repository.listSavedLocations,
    createSavedLocation: repository.createSavedLocation,
    deleteSavedLocation: repository.deleteSavedLocation,

    async getJourneySummary(tripId: string, viewerId?: string) {
      const route = await repository.getRoute(tripId)
      const plan = await repository.getPlan(tripId)

      if (!route && !plan) {
        return null
      }

      const entity = (route ?? plan)!
      const counterpart = route
        ? await findAcceptedForRoute(route)
        : await findAcceptedForPlan(plan!)
      const reviewEligibility = viewerId
        ? await repository.getReviewEligibility(entity.id, viewerId)
        : undefined

      return buildJourneySummary(entity, counterpart, reviewEligibility)
    },
  }
}

export const journeyService = createJourneyService(journeyRepository)
export type JourneyService = ReturnType<typeof createJourneyService>
