import { query, withTransaction } from '../db/connection'
import { mapCounterpartyRow, mapRows, parseLocationJson, parseNumeric, toCamelCase, toCamelCaseRecord } from '../db/utils'
import { GroupOffer } from '../types/entities'
import type { HydratedClientGroupOffer } from '../types/payloads'
import { cascadeDeclineSiblingsTx } from './matchCascade'
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

function mapHydratedGroupOfferRow(row: Record<string, unknown>): HydratedClientGroupOffer {
  const r = toCamelCaseRecord(row)
  const counterparty = mapCounterpartyRow(r)

  const routeOrigin = parseLocationJson(r.routeOrigin)
  const routeDestination = parseLocationJson(r.routeDestination)
  const route =
    routeOrigin && routeDestination && r.routeDeparture && r.routeDepartureEnd
      ? {
          origin: routeOrigin,
          destination: routeDestination,
          departureWindowStartDate: r.routeDeparture as string,
          departureWindowEndDate: r.routeDepartureEnd as string,
        }
      : null

  const planPassengerCount =
    r.planPassengerCount != null ? Number(r.planPassengerCount) : null
  const plan =
    planPassengerCount != null
      ? {
          passengerCount: planPassengerCount,
          origin: parseLocationJson(r.planOrigin) ?? undefined,
          destination: parseLocationJson(r.planDestination) ?? undefined,
        }
      : null

  return {
    id: r.id as string,
    groupRequestId: r.groupRequestId as string,
    routeId: r.routeId as string,
    driverId: r.driverId as string,
    clientId: r.clientId as string,
    planId: r.planId as string,
    tripPrice: parseNumeric(r.tripPrice),
    status: r.status as string,
    createdAt: r.createdAt as string | undefined,
    counterparty,
    route,
    plan,
  }
}

export async function listGroupOffersByClient(clientId: string, statuses?: string[]): Promise<HydratedClientGroupOffer[]> {
  const hasStatuses = statuses && statuses.length > 0
  const statusClause = hasStatuses
    ? `AND go.status IN (${statuses!.map(() => '?').join(',')})`
    : ''
  const params = hasStatuses ? [clientId, ...statuses!] : [clientId]
  const result = await query(
    `
    SELECT go.*,
           r.origin              AS route_origin,
           r.destination         AS route_destination,
           r.departure_window_start_date AS route_departure,
           r.departure_window_end_date   AS route_departure_end,
           p.passenger_count     AS plan_passenger_count,
           p.origin              AS plan_origin,
           p.destination         AS plan_destination,
           u.id                                      AS cp_id,
           COALESCE(ui.display_name, u.display_name) AS cp_display_name,
           COALESCE(ui.avatar_url, u.avatar_url)     AS cp_avatar_url,
           u.rating_avg                              AS cp_rating_avg,
           u.trip_count                              AS cp_trip_count,
           u.verification_status                     AS cp_verification_status
    FROM group_offers go
    INNER JOIN routes r ON r.id = go.route_id
    LEFT JOIN plans p ON p.id = go.plan_id
    LEFT JOIN users u ON u.id = go.driver_id
    LEFT JOIN identities ui ON ui.id = u.identity_id
    WHERE go.client_id = ?
      ${statusClause}
      AND r.status NOT IN ('completed', 'canceled')
      AND (p.id IS NULL OR p.status NOT IN ('completed', 'canceled'))
    ORDER BY go.created_at DESC, go.id DESC
    `,
    params,
  )
  return result.rows.map(mapHydratedGroupOfferRow)
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

    const siblingIdParams: unknown[] = [updatedOffer.id, updatedOffer.routeId]
    let siblingIdScope = 'route_id = ?'
    if (updatedOffer.planId) {
      siblingIdScope = `(${siblingIdScope} OR plan_id = ?)`
      siblingIdParams.push(updatedOffer.planId)
    }
    const siblingIdsRes = await tx.query(
      `SELECT id FROM group_offers WHERE status = 'pending' AND id != ? AND ${siblingIdScope}`,
      siblingIdParams,
    )
    const siblingIds = siblingIdsRes.rows.map((r) => String(r.id))

    await cascadeDeclineSiblingsTx(tx, {
      routeId: updatedOffer.routeId,
      planId: updatedOffer.planId,
      exceptGroupOfferId: updatedOffer.id,
    })

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
