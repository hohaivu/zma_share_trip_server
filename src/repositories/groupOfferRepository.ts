import { query, withTransaction } from '../db/connection'
import { mapRows, parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { GroupOffer, Route } from '../types/entities'
import {
  chargeRouteFeeTx,
  loadRouteForWalletTx,
  type DbQueryExecutor,
} from './walletRepository'

function mapRoute(row: Record<string, unknown>): Route {
  const route = toCamelCase<Route>(row)
  if (!route) throw new Error('Cannot map null row to Route')
  route.tripPrice = parseNumeric(route.tripPrice)
  route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd)
  return route
}

function isTerminalTripStatus(status?: string | null): boolean {
  return status === 'completed' || status === 'canceled'
}

const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE route_id = $1 AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM route_requests WHERE route_id = $1 AND status = 'accepted'
`

export async function assertUserRole(userId: string, role: 'driver' | 'client'): Promise<void> {
  const result = await query('SELECT role FROM users WHERE id = $1', [userId])
  const user = result.rows[0] as { role?: string } | undefined
  if (!user) throw new HttpError(404, 'User not found')
  if (user.role !== role) throw new HttpError(403, `User must be a ${role} persona`)
}

export function emitNotification(type: string, recipientId: string, data: Record<string, unknown>): void {
  const copy = type === 'group_offer_accepted'
    ? { type: 'request_accepted', title: 'Request accepted', body: 'Your request was accepted.', targetRoute: '/journeys', deepLink: '/journeys', requestSource: 'group_offer' }
    : type === 'group_offer_declined'
      ? { type: 'request_declined', title: 'Request declined', body: 'Your request was declined.', targetRoute: '/offers', deepLink: '/offers', requestSource: 'group_offer' }
      : { type: 'request_closed', title: 'Request closed', body: 'This request is no longer available.', targetRoute: '/offers', deepLink: '/offers', requestSource: 'group_offer' }

  void query(
    `
      INSERT INTO notifications (
        id, recipient_id, type, title, body, target_route, deep_link,
        request_source, metadata, read, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW())
    `,
    [`notif-${Date.now()}${Math.random().toString().slice(2, 6)}`, recipientId, copy.type, copy.title, copy.body, copy.targetRoute, copy.deepLink, copy.requestSource, JSON.stringify(data)],
  ).catch((error) => {
    console.error('[emitNotification] failed to persist notification', error)
  })
}

async function checkRouteAvailability(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<boolean> {
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId])
  return result.rowCount === 0
}

async function shouldHideOfferForTerminalTrip(offer: Pick<GroupOffer, 'routeId' | 'planId'>): Promise<boolean> {
  const routeRes = await query('SELECT status FROM routes WHERE id = $1', [offer.routeId])
  if (isTerminalTripStatus((routeRes.rows[0] as { status?: string } | undefined)?.status)) {
    return true
  }

  if (!offer.planId) return false
  const planRes = await query('SELECT status FROM plans WHERE id = $1', [offer.planId])
  return isTerminalTripStatus((planRes.rows[0] as { status?: string } | undefined)?.status)
}

async function filterVisibleForActiveTrip<T extends Pick<GroupOffer, 'routeId' | 'planId'>>(
  offers: T[],
): Promise<T[]> {
  const visibility = await Promise.all(offers.map((offer) => shouldHideOfferForTerminalTrip(offer)))
  return offers.filter((_, index) => !visibility[index])
}

export async function listGroupOffersByClient(clientId: string): Promise<GroupOffer[]> {
  const offersRes = await query(
    'SELECT * FROM group_offers WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
    [clientId],
  )
  return filterVisibleForActiveTrip(mapRows<GroupOffer>(offersRes.rows))
}

export interface AcceptGroupOfferResult {
  updatedOffer: GroupOffer
  siblings: GroupOffer[]
  offer: GroupOffer
}

export async function acceptGroupOffer(offerId: string): Promise<AcceptGroupOfferResult> {
  return withTransaction(async (tx) => {
    let offerRes = await tx.query('SELECT * FROM group_offers WHERE id = $1 FOR UPDATE', [offerId])
    const offer = toCamelCase<GroupOffer>(offerRes.rows[0])
    if (!offer) throw new HttpError(404, 'Group offer not found')
    if (offer.status === 'accepted') return { updatedOffer: offer, siblings: [], offer }
    if (offer.status !== 'pending') throw new HttpError(409, `Cannot accept offer in status: ${offer.status}`)

    const route = await loadRouteForWalletTx(tx, offer.routeId, mapRoute)
    if (route.status !== 'published') throw new HttpError(409, `Cannot accept offer on route in status: ${route.status}`)
    if (!(await checkRouteAvailability(tx, offer.routeId))) {
      throw new HttpError(409, 'Route is no longer available — another client was accepted first')
    }

    offerRes = await tx.query("UPDATE group_offers SET status = 'accepted' WHERE id = $1 RETURNING *", [offerId])
    const updatedOffer = toCamelCase<GroupOffer>(offerRes.rows[0])
    if (!updatedOffer) throw new Error('Failed to update group offer')

    await tx.query("UPDATE routes SET status = 'matched' WHERE id = $1", [offer.routeId])
    if (updatedOffer.planId) {
      await tx.query("UPDATE plans SET status = 'matched' WHERE id = $1 AND status = 'published'", [updatedOffer.planId])
    }

    await chargeRouteFeeTx(tx, route, mapRoute, { description: 'Route fee charged on accepted group offer' })

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

    await tx.query("UPDATE route_requests SET status = 'closed' WHERE route_id = $1 AND status = 'pending'", [offer.routeId])

    return { updatedOffer, siblings, offer }
  })
}

export async function declineGroupOffer(offerId: string): Promise<GroupOffer> {
  const offerRes = await query('SELECT * FROM group_offers WHERE id = $1', [offerId])
  const offer = toCamelCase<GroupOffer>(offerRes.rows[0])
  if (!offer) throw new Error('Group offer not found')
  if (offer.status !== 'pending') throw new Error(`Cannot decline offer in status: ${offer.status}`)

  const updatedRes = await query("UPDATE group_offers SET status = 'declined' WHERE id = $1 RETURNING *", [offerId])
  const updated = toCamelCase<GroupOffer>(updatedRes.rows[0])
  if (!updated) throw new Error('Failed to update group offer')
  return updated
}
