import { query } from '../db/connection'
import { mapRows } from '../db/utils'
import { HttpError } from '../http-error'
import { GroupOffer, Plan, Route, RouteRequest } from '../types/entities'
import { ReviewEligibility, WithReviewEligibility } from '../types/payloads'
import { type DbQueryExecutor } from './walletRepository'

type AcceptedJourneyMatch =
  | { kind: 'route_request'; request: RouteRequest }
  | { kind: 'group_offer'; offer: GroupOffer }

export type TripListScope = 'active' | 'history'

function isTerminalTripStatus(status?: string | null): boolean {
  return status === 'completed' || status === 'canceled'
}

function isActiveTripStatus(status?: string | null): boolean {
  return status === 'draft' || status === 'published' || status === 'matched'
}

export async function findAcceptedRouteMatchTx(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<AcceptedJourneyMatch | null> {
  const searchRes = await executor.query(
    `SELECT * FROM route_requests WHERE route_id = $1 AND status = 'accepted' FOR UPDATE`,
    [routeId],
  )
  const acceptedSearch = mapRows<RouteRequest>(searchRes.rows)[0]
  if (acceptedSearch) return { kind: 'route_request', request: acceptedSearch }

  const offerRes = await executor.query(
    `SELECT * FROM group_offers WHERE route_id = $1 AND status = 'accepted' FOR UPDATE`,
    [routeId],
  )
  const acceptedOffer = mapRows<GroupOffer>(offerRes.rows)[0]
  return acceptedOffer ? { kind: 'group_offer', offer: acceptedOffer } : null
}

export async function findAcceptedPlanMatchTx(
  executor: DbQueryExecutor,
  plan: Plan,
): Promise<AcceptedJourneyMatch | null> {
  const searchRes = await executor.query(
    `SELECT * FROM route_requests WHERE client_id = $1 AND plan_id = $2 AND status IN ('pending', 'accepted') FOR UPDATE`,
    [plan.clientId, plan.id],
  )
  const acceptedSearch = mapRows<RouteRequest>(searchRes.rows).find(
    (request) => request.status === 'accepted',
  )
  if (acceptedSearch) return { kind: 'route_request', request: acceptedSearch }

  const offerRes = await executor.query(
    `SELECT * FROM group_offers WHERE client_id = $1 AND plan_id = $2 AND status IN ('pending', 'accepted') FOR UPDATE`,
    [plan.clientId, plan.id],
  )
  const acceptedOffer = mapRows<GroupOffer>(offerRes.rows).find(
    (offer) => offer.status === 'accepted',
  )
  return acceptedOffer ? { kind: 'group_offer', offer: acceptedOffer } : null
}

function buildReviewEligibility(
  values: Partial<ReviewEligibility> & Pick<ReviewEligibility, 'reason'>,
): ReviewEligibility {
  return {
    canSubmit: values.reason === 'eligible',
    hasSubmitted: values.hasSubmitted ?? false,
    reason: values.reason,
    windowClosesAt: values.windowClosesAt ?? null,
    revieweeId: values.revieweeId ?? null,
  }
}

function getAcceptedCounterpartId(
  accepted: AcceptedJourneyMatch | null,
  viewerId: string,
): string | null {
  if (!accepted) return null
  const driverId =
    accepted.kind === 'route_request'
      ? accepted.request.driverId
      : accepted.offer.driverId
  const clientId =
    accepted.kind === 'route_request'
      ? accepted.request.clientId
      : accepted.offer.clientId
  if (viewerId === driverId) return clientId
  if (viewerId === clientId) return driverId
  return null
}

function getWindowClosesAt(completedAt?: string | null): string | null {
  if (!completedAt) return null
  const completedTime = new Date(completedAt).getTime()
  if (!Number.isFinite(completedTime)) return null
  return new Date(completedTime + 24 * 60 * 60 * 1000).toISOString()
}

async function hasReviewerSubmittedTripReview(
  tripId: string,
  reviewerId: string,
): Promise<boolean> {
  const result = await query(
    'SELECT 1 FROM reviews WHERE trip_id = $1 AND reviewer_id = $2 LIMIT 1',
    [tripId, reviewerId],
  )
  return result.rows.length > 0
}

export async function getReviewEligibility(
  tripId: string,
  viewerId: string,
  getRoute: (id: string) => Promise<Route | null>,
  getPlan: (id: string) => Promise<Plan | null>,
  now: Date = new Date(),
): Promise<ReviewEligibility> {
  const route = await getRoute(tripId)
  const plan = route ? null : await getPlan(tripId)
  const trip = route ?? plan
  if (!trip) throw new HttpError(404, 'Trip not found')

  const accepted = route
    ? await findAcceptedRouteMatchTx({ query }, route.id)
    : await findAcceptedPlanMatchTx({ query }, plan!)
  const revieweeId = getAcceptedCounterpartId(accepted, viewerId)
  if (!accepted) return buildReviewEligibility({ reason: 'missing_counterpart' })
  if (!revieweeId) return buildReviewEligibility({ reason: 'not_participant' })

  const hasSubmitted = await hasReviewerSubmittedTripReview(trip.id, viewerId)
  const windowClosesAt = getWindowClosesAt(trip.completedAt)
  if (hasSubmitted) {
    return buildReviewEligibility({
      reason: 'already_submitted',
      hasSubmitted,
      windowClosesAt,
      revieweeId,
    })
  }
  if (trip.status !== 'completed') {
    return buildReviewEligibility({ reason: 'not_completed', revieweeId })
  }
  if (!trip.completedAt) {
    return buildReviewEligibility({ reason: 'missing_completed_at', revieweeId })
  }
  const completedTime = new Date(trip.completedAt).getTime()
  const nowTime = now.getTime()
  if (!Number.isFinite(completedTime) || completedTime > nowTime) {
    return buildReviewEligibility({ reason: 'missing_completed_at', revieweeId })
  }
  if (nowTime > completedTime + 24 * 60 * 60 * 1000) {
    return buildReviewEligibility({
      reason: 'outside_window',
      windowClosesAt,
      revieweeId,
    })
  }
  return buildReviewEligibility({ reason: 'eligible', windowClosesAt, revieweeId })
}

export async function withReviewEligibility<T extends Route | Plan>(
  trip: T,
  viewerId: string,
  getRoute: (id: string) => Promise<Route | null>,
  getPlan: (id: string) => Promise<Plan | null>,
): Promise<WithReviewEligibility<T>> {
  return {
    ...trip,
    reviewEligibility: await getReviewEligibility(
      trip.id,
      viewerId,
      getRoute,
      getPlan,
    ),
  }
}

async function isTripVisibleInWorkQueue(
  trip: Pick<Route | Plan, 'id' | 'status' | 'serviceDate'>,
  reviewerId: string,
  getRoute: (id: string) => Promise<Route | null>,
  getPlan: (id: string) => Promise<Plan | null>,
): Promise<boolean> {
  if (isActiveTripStatus(trip.status)) return true
  if (trip.status !== 'completed') return false
  return (await getReviewEligibility(trip.id, reviewerId, getRoute, getPlan)).canSubmit
}

function normalizeTripListScope(scope?: string): TripListScope {
  return scope === 'history' ? 'history' : 'active'
}

function isTripVisibleInHistory(trip: Pick<Route | Plan, 'status'>): boolean {
  return isTerminalTripStatus(trip.status)
}

export async function filterTripsByScope<
  T extends Pick<Route | Plan, 'id' | 'status' | 'serviceDate'>,
>(
  trips: T[],
  scope: TripListScope,
  viewerId: string,
  getRoute: (id: string) => Promise<Route | null>,
  getPlan: (id: string) => Promise<Plan | null>,
): Promise<T[]> {
  if (normalizeTripListScope(scope) === 'history') {
    return trips.filter(isTripVisibleInHistory)
  }
  const visibility = await Promise.all(
    trips.map((trip) =>
      isTripVisibleInWorkQueue(trip, viewerId, getRoute, getPlan),
    ),
  )
  return trips.filter((_, index) => visibility[index])
}
