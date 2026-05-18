import { query, withTransaction } from '../db/connection'
import { mapRows, parseNumeric, toCamelCase } from '../db/utils'
import { GroupOffer, Route } from '../types/entities'
import { chargeRouteFeeTx, loadRouteForWalletTx } from './walletRepository'
import { assertRoutePlanEndsInFutureTx, expirePendingMatchesTx } from './requestLifecycleRepository'

function mapRoute(row: Record<string, unknown>): Route {
  const route = toCamelCase<Route>(row)
  if (!route) throw new Error('Cannot map null row to Route')
  route.tripPrice = parseNumeric(route.tripPrice)
  route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd)
  return route
}

const MATCH_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE (route_id = $1 OR plan_id = $2) AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM route_requests WHERE (route_id = $1 OR plan_id = $2) AND status = 'accepted'
`

export async function getGroupOfferById(offerId: string): Promise<GroupOffer | null> {
  const result = await query('SELECT * FROM group_offers WHERE id = $1', [offerId])
  return toCamelCase<GroupOffer>(result.rows[0])
}

export async function getRouteStatus(routeId: string): Promise<string | null> {
  const result = await query('SELECT status FROM routes WHERE id = $1', [routeId])
  const row = result.rows[0] as { status?: string } | undefined
  return row?.status ?? null
}

export async function getPlanStatus(planId: string): Promise<string | null> {
  const result = await query('SELECT status FROM plans WHERE id = $1', [planId])
  const row = result.rows[0] as { status?: string } | undefined
  return row?.status ?? null
}

export async function listGroupOffersByClient(clientId: string): Promise<GroupOffer[]> {
  await expirePendingMatchesTx({ query })
  const offersRes = await query(
    'SELECT * FROM group_offers WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
    [clientId],
  )
  return mapRows<GroupOffer>(offersRes.rows)
}

export async function listGroupOffersByRoute(routeId: string): Promise<GroupOffer[]> {
  await expirePendingMatchesTx({ query })
  const offersRes = await query(
    'SELECT * FROM group_offers WHERE route_id = $1 ORDER BY created_at DESC, id DESC',
    [routeId],
  )
  return mapRows<GroupOffer>(offersRes.rows)
}

export interface AcceptGroupOfferTxResult {
  status: 'accepted' | 'already_accepted' | 'not_pending' | 'route_unpublished' | 'route_unavailable' | 'not_found'
  offer?: GroupOffer
  updatedOffer?: GroupOffer
  siblings?: GroupOffer[]
  routeStatus?: string
}

/**
 * Transactionally accept a group offer. All multi-table writes happen under
 * the same transaction so that state transitions are atomic. Business
 * decisions about whether to surface "not_pending"/"route_unpublished" as
 * user-facing errors live in the service layer.
 */
export async function acceptGroupOfferTx(offerId: string): Promise<AcceptGroupOfferTxResult> {
  return withTransaction(async (tx) => {
    await expirePendingMatchesTx(tx)
    const offerRes = await tx.query(
      'SELECT * FROM group_offers WHERE id = $1 FOR UPDATE',
      [offerId],
    )
    const offer = toCamelCase<GroupOffer>(offerRes.rows[0])
    if (!offer) return { status: 'not_found' as const }
    if (offer.status === 'accepted') {
      return { status: 'already_accepted' as const, offer, updatedOffer: offer, siblings: [] }
    }
    if (offer.status !== 'pending') {
      return { status: 'not_pending' as const, offer }
    }

    const route = await loadRouteForWalletTx(tx, offer.routeId, mapRoute)
    const planRes = offer.planId
      ? await tx.query('SELECT status FROM plans WHERE id = $1 FOR UPDATE', [offer.planId])
      : null
    const planStatus = planRes?.rows[0]?.status as string | undefined
    if (route.status !== 'published') {
      return { status: 'route_unpublished' as const, offer, routeStatus: route.status }
    }
    if (offer.planId && planStatus !== 'published') {
      return { status: 'route_unpublished' as const, offer, routeStatus: planStatus }
    }
    await assertRoutePlanEndsInFutureTx(tx, offer.routeId, offer.planId, 'Route or plan has expired')

    const availabilityRes = await tx.query(MATCH_ACCEPTED_SQL, [offer.routeId, offer.planId])
    if (availabilityRes.rowCount !== 0) {
      return { status: 'route_unavailable' as const, offer }
    }

    const updatedRes = await tx.query(
      "UPDATE group_offers SET status = 'accepted' WHERE id = $1 AND status = 'pending' RETURNING *",
      [offerId],
    )
    const updatedOffer = toCamelCase<GroupOffer>(updatedRes.rows[0])
    if (!updatedOffer) throw new Error('Failed to update group offer')

    const routeUpdateRes = await tx.query("UPDATE routes SET status = 'matched' WHERE id = $1 AND status = 'published'", [offer.routeId])
    if (routeUpdateRes.rowCount === 0) throw new Error('Matched route was no longer published')
    if (updatedOffer.planId) {
      const planUpdateRes = await tx.query(
        "UPDATE plans SET status = 'matched' WHERE id = $1 AND status = 'published'",
        [updatedOffer.planId],
      )
      if (planUpdateRes.rowCount === 0) throw new Error('Matched plan was no longer published')
    }

    await chargeRouteFeeTx(tx, route, mapRoute, {
      description: 'Route fee charged on accepted group offer',
    })

    const siblingsRes = await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND id != $2 AND status = 'pending' RETURNING *",
      [offer.groupRequestId, offerId],
    )
    const siblings = mapRows<GroupOffer>(siblingsRes.rows)

    await tx.query(
      `
      UPDATE group_requests
      SET status = 'accepted', accepted_client_user_id = $1, accepted_plan_id = $2, client_id = $1
      WHERE id = $3
      `,
      [updatedOffer.clientId, updatedOffer.planId, updatedOffer.groupRequestId],
    )

    await tx.query(
      "UPDATE route_requests SET status = 'closed' WHERE (route_id = $1 OR plan_id = $2) AND status = 'pending'",
      [offer.routeId, updatedOffer.planId],
    )

    await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE (route_id = $1 OR plan_id = $2) AND id != $3 AND status = 'pending'",
      [offer.routeId, updatedOffer.planId, offerId],
    )

    return { status: 'accepted' as const, offer, updatedOffer, siblings }
  })
}

export async function markGroupOfferDeclined(offerId: string): Promise<GroupOffer | null> {
  const updatedRes = await query(
    "UPDATE group_offers SET status = 'declined' WHERE id = $1 RETURNING *",
    [offerId],
  )
  return toCamelCase<GroupOffer>(updatedRes.rows[0])
}
