import { journeyRepository, JourneyRepository } from '../repositories/journeyRepository'
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
    cancelTrip: repository.cancelTrip,
    completeTrip: repository.completeTrip,
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
