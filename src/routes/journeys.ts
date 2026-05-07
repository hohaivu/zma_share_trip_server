import { Request, Response, Router } from 'express'

import * as store from '../store'
import { GroupOffer, Plan, Route, RouteRequest } from '../types/entities'
import { JourneyAcceptedState, JourneySummary } from '../types/payloads'
import { asyncHandler } from './helpers'

const router = Router()

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
): T & Pick<JourneySummary, 'accepted'> {
  return { ...entity, accepted }
}

/**
 * Shared helper: find an accepted match (search request or group offer) for an entity.
 */
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

async function findAcceptedForRoute(
  route: Route,
): Promise<JourneyAcceptedState | null> {
  if (route.status === 'canceled') {
    return null
  }
  return findAccepted(
    () => store.listRouteRequestsByRoute(route.id),
    () => store.listGroupOffersByRoute(route.id),
    null,
    async (accepted) => ({
      type: 'route_request',
      requestId: accepted.id,
      matchedUser: (await store.getUser(accepted.clientId)) || null,
      plan: accepted.planId ? await store.getPlan(accepted.planId) : null,
      tripPrice: accepted.tripPrice ?? 0,
      status: accepted.status,
    }),
    async (accepted) => ({
      type: 'group_offer',
      offerId: accepted.id,
      matchedUser: (await store.getUser(accepted.clientId)) || null,
      route: await store.getRoute(accepted.routeId),
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
    () => store.listRouteRequestsByPlan(plan.id),
    () => store.listGroupOffersByPlan(plan.id),
    plan.id,
    async (accepted) => ({
      type: 'route_request',
      requestId: accepted.id,
      matchedUser: (await store.getUser(accepted.driverId)) || null,
      plan: accepted.planId ? await store.getPlan(accepted.planId) : null,
      tripPrice: accepted.tripPrice ?? 0,
      status: accepted.status,
    }),
    async (accepted) => ({
      type: 'group_offer',
      offerId: accepted.id,
      matchedUser: (await store.getUser(accepted.driverId)) || null,
      route: (await store.getRoute(accepted.routeId)) || null,
      tripPrice: accepted.tripPrice,
      status: accepted.status,
    }),
  )
}

const getJourneySummaryHandler = asyncHandler(
  async (req: Request<{ id: string }>, res: Response) => {
    const tripId = req.params.id
    const route = await store.getRoute(tripId)
    const plan = await store.getPlan(tripId)

    if (!route && !plan) {
      return res.status(404).json({ message: 'Trip not found' })
    }

    const entity = (route ?? plan)!
    const counterpart = route
      ? await findAcceptedForRoute(route)
      : await findAcceptedForPlan(plan!)

    res.json(buildJourneySummary(entity, counterpart))
  },
)

// GET /api/journeys/:id/summary
router.get('/journeys/:id/summary', getJourneySummaryHandler)

// POST /api/trips/:id/cancel
router.post(
  '/trips/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const tripId = req.params.id as string
    const canceled = await store.cancelTrip(tripId)
    res.json(canceled)
  }),
)

// POST /api/trips/:id/complete
router.post(
  '/trips/:id/complete',
  asyncHandler(async (req: Request, res: Response) => {
    const updated = await store.completeTrip(req.params.id as string)
    res.json(updated)
  }),
)

// Deprecated: saved locations

router.get(
  '/trips/saved-locations',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await store.listSavedLocations())
  }),
)

router.post(
  '/trips/saved-locations',
  asyncHandler(async (req: Request, res: Response) => {
    const location = await store.createSavedLocation(req.body || {})
    res.status(201).json(location)
  }),
)

router.delete(
  '/trips/saved-locations/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await store.deleteSavedLocation(req.params.id as string)
    if (!deleted) {
      return res.status(404).json({ message: 'Saved location not found' })
    }
    res.status(204).end()
  }),
)

export default router
