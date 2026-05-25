import { query, withTransaction } from '../db/connection'
import { mapRows, toCamelCase } from '../db/utils'
import { GroupOffer } from '../types/entities'
import { mapRoute, ROUTE_ACCEPTED_SQL } from './routeAvailabilityRepository'
import { chargeRouteFeeTx, loadRouteForWalletTx } from './walletRepository'

export async function getGroupOfferById(offerId: string): Promise<GroupOffer | null> {
  const result = await query('SELECT * FROM group_offers WHERE id = ?', [offerId])
  return toCamelCase<GroupOffer>(result.rows[0])
}

export async function getRouteStatus(routeId: string): Promise<string | null> {
  const result = await query('SELECT status FROM routes WHERE id = ?', [routeId])
  const row = result.rows[0] as { status?: string } | undefined
  return row?.status ?? null
}

export async function getPlanStatus(planId: string): Promise<string | null> {
  const result = await query('SELECT status FROM plans WHERE id = ?', [planId])
  const row = result.rows[0] as { status?: string } | undefined
  return row?.status ?? null
}

export async function listGroupOffersByClient(clientId: string, statuses?: string[]): Promise<GroupOffer[]> {
  const statusParams = statuses && statuses.length > 0 ? statuses : []
  const statusClause = statusParams.length > 0
    ? ` AND status IN (${statusParams.map(() => '?').join(',')})`
    : ''
  const offersRes = await query(
    `SELECT * FROM group_offers WHERE client_id = ?${statusClause} ORDER BY created_at DESC, id DESC`,
    [clientId, ...statusParams],
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
      'SELECT * FROM group_offers WHERE id = ? FOR UPDATE',
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

    const availabilityRes = await tx.query(ROUTE_ACCEPTED_SQL, [offer.routeId, offer.routeId])
    if (availabilityRes.rowCount !== 0) {
      return { status: 'route_unavailable' as const, offer }
    }

    await tx.query(
      "UPDATE group_offers SET status = 'accepted' WHERE id = ?",
      [offerId],
    )
    const updatedRes = await tx.query('SELECT * FROM group_offers WHERE id = ?', [offerId])
    const updatedOffer = toCamelCase<GroupOffer>(updatedRes.rows[0])
    if (!updatedOffer) throw new Error('Failed to update group offer')

    await tx.query("UPDATE routes SET status = 'matched' WHERE id = ?", [offer.routeId])
    if (updatedOffer.planId) {
      await tx.query(
        "UPDATE plans SET status = 'matched' WHERE id = ? AND status = 'published'",
        [updatedOffer.planId],
      )
    }

    await chargeRouteFeeTx(tx, route, mapRoute, {
      description: 'Route fee charged on accepted group offer',
    })

    const siblingIdsRes = await tx.query(
      "SELECT id FROM group_offers WHERE group_request_id = ? AND id != ? AND status = 'pending'",
      [offer.groupRequestId, offerId],
    )
    const siblingIds = siblingIdsRes.rows.map((r) => String(r.id))
    await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = ? AND id != ? AND status = 'pending'",
      [offer.groupRequestId, offerId],
    )
    let siblings: GroupOffer[] = []
    if (siblingIds.length > 0) {
      const siblingsRes = await tx.query(
        `SELECT * FROM group_offers WHERE id IN (${siblingIds.map(() => '?').join(',')})`,
        siblingIds,
      )
      siblings = mapRows<GroupOffer>(siblingsRes.rows)
    }

    await tx.query(
      `
      UPDATE group_requests
      SET status = 'accepted', accepted_client_user_id = ?, accepted_plan_id = ?, client_id = ?
      WHERE id = ?
      `,
      [updatedOffer.clientId, updatedOffer.planId, updatedOffer.clientId, updatedOffer.groupRequestId],
    )

    await tx.query(
      "UPDATE route_requests SET status = 'closed' WHERE route_id = ? AND status = 'pending'",
      [offer.routeId],
    )

    return { status: 'accepted' as const, offer, updatedOffer, siblings }
  })
}

export async function markGroupOfferDeclined(offerId: string): Promise<GroupOffer | null> {
  await query(
    "UPDATE group_offers SET status = 'declined' WHERE id = ?",
    [offerId],
  )
  const updatedRes = await query('SELECT * FROM group_offers WHERE id = ?', [offerId])
  return toCamelCase<GroupOffer>(updatedRes.rows[0])
}
