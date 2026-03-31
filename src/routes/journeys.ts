import { Router, Request, Response } from 'express';
import * as store from '../store';
import { asyncHandler } from './helpers';
import { GroupOffer, Plan, Route, SearchRequest } from '../types/entities';
import { JourneyAcceptedState, JourneySummary } from '../types/payloads';

const router = Router();

type AcceptedSearchSummary = Extract<
  JourneyAcceptedState,
  { type: 'search_request' }
>;
type AcceptedGroupSummary = Extract<
  JourneyAcceptedState,
  { type: 'group_offer' }
>;

export function buildJourneySummary<T extends Route | Plan>(
  entity: T,
  accepted: JourneyAcceptedState | null
): T & Pick<JourneySummary, 'accepted'> {
  return {
    ...entity,
    accepted,
  };
}

/**
 * Shared helper: find an accepted match (search request or group offer) for an entity.
 */
async function findAccepted(
  getSearchReqs: () => Promise<SearchRequest[]>,
  getGroupOffers: () => Promise<GroupOffer[]>,
  planId: string | null,
  buildSearchAccepted: (accepted: SearchRequest) => Promise<AcceptedSearchSummary>,
  buildGroupAccepted: (accepted: GroupOffer) => Promise<AcceptedGroupSummary>
): Promise<JourneyAcceptedState | null> {
  const searchReqs = await getSearchReqs();
  const acceptedSearch = searchReqs.find(
    (r) => r.status === 'accepted' && (planId === null || r.planId === planId)
  );
  if (acceptedSearch) {
    return buildSearchAccepted(acceptedSearch);
  }

  const groupOffers = await getGroupOffers();
  const acceptedOffer = groupOffers.find(
    (o) => o.status === 'accepted' && (planId === null || o.planId === planId)
  );
  if (acceptedOffer) {
    return buildGroupAccepted(acceptedOffer);
  }

  return null;
}

async function findAcceptedForRoute(route: Route): Promise<JourneyAcceptedState | null> {
  return findAccepted(
    () => store.listSearchRequestsByRoute(route.id),
    () => store.listGroupOffersByRoute(route.id),
    null,
    async (accepted) => ({
      type: 'search_request',
      requestId: accepted.id,
      matchedUser: (await store.getUser(accepted.clientId)) || null,
      plan: accepted.planId ? (await store.getPlan(accepted.planId)) : null,
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
  );
}

async function findAcceptedForPlan(plan: Plan): Promise<JourneyAcceptedState | null> {
  return findAccepted(
    () => store.listSearchRequestsByClient(plan.clientId),
    () => store.listGroupOffersByClient(plan.clientId),
    plan.id,
    async (accepted) => ({
      type: 'search_request',
      requestId: accepted.id,
      matchedUser: (await store.getUser(accepted.driverId)) || null,
      plan: accepted.planId ? (await store.getPlan(accepted.planId)) : null,
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
  );
}

// GET /api/trips/:id/summary
router.get('/trips/:id/summary', asyncHandler(async (
  req: Request<{ id: string }>,
  res: Response
) => {
  const tripId = req.params.id;
  const route = await store.getRoute(tripId);
  const plan = await store.getPlan(tripId);

  if (!route && !plan) {
    return res.status(404).json({ message: 'Trip not found' });
  }

  const entity = (route ?? plan)!;
  const counterpart = route
    ? await findAcceptedForRoute(route)
    : await findAcceptedForPlan(plan!);

  res.json(buildJourneySummary(entity, counterpart));
}));

// POST /api/trips/:id/complete
router.post('/trips/:id/complete', asyncHandler(async (req: Request, res: Response) => {
  const tripId = req.params.id as string;
  const route = await store.getRoute(tripId);
  const plan = await store.getPlan(tripId);

  if (!route && !plan) {
    return res.status(404).json({ message: 'Trip not found' });
  }

  if (route) {
    const updated = await store.updateRoute(tripId, { status: 'completed' });
    return res.json(updated);
  }

  const updated = await store.updatePlan(tripId, { status: 'completed' });
  res.json(updated);
}));

// Deprecated: saved locations

router.get('/trips/saved-locations', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await store.listSavedLocations());
}));

router.post('/trips/saved-locations', asyncHandler(async (req: Request, res: Response) => {
  const location = await store.createSavedLocation(req.body || {});
  res.status(201).json(location);
}));

router.delete('/trips/saved-locations/:id', asyncHandler(async (req: Request, res: Response) => {
  const deleted = await store.deleteSavedLocation(req.params.id as string);
  if (!deleted) {
    return res.status(404).json({ message: 'Saved location not found' });
  }
  res.status(204).end();
}));

export default router;
