import { query, withTransaction } from '../db/connection'
import { mapRows, toCamelCase } from '../db/utils'
import { GroupOffer } from '../types/entities'
import { mapRoute, ROUTE_ACCEPTED_SQL } from './routeAvailabilityRepository'
import { chargeRouteFeeTx, loadRouteForWalletTx } from './walletRepository'

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
  const offersRes = await query(
    'SELECT * FROM group_offers WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
    [clientId],
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
    if (route.status !== 'published') {
      return { status: 'route_unpublished' as const, offer, routeStatus: route.status }
    }

    const availabilityRes = await tx.query(ROUTE_ACCEPTED_SQL, [offer.routeId])
    if (availabilityRes.rowCount !== 0) {
      return { status: 'route_unavailable' as const, offer }
    }

    const updatedRes = await tx.query(
      "UPDATE group_offers SET status = 'accepted' WHERE id = $1 RETURNING *",
      [offerId],
    )
    const updatedOffer = toCamelCase<GroupOffer>(updatedRes.rows[0])
    if (!updatedOffer) throw new Error('Failed to update group offer')

    await tx.query("UPDATE routes SET status = 'matched' WHERE id = $1", [offer.routeId])
    if (updatedOffer.planId) {
      await tx.query(
        "UPDATE plans SET status = 'matched' WHERE id = $1 AND status = 'published'",
        [updatedOffer.planId],
      )
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
      "UPDATE route_requests SET status = 'closed' WHERE route_id = $1 AND status = 'pending'",
      [offer.routeId],
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
