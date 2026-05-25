import { query } from '../db/connection'
import {
  mapCounterpartyRow,
  parseLocationJson,
  toCamelCaseRecord,
} from '../db/utils'
import type { HydratedClientRequestItem } from '../types/payloads'

function mapRow(row: Record<string, unknown>): HydratedClientRequestItem {
  const r = toCamelCaseRecord(row)
  const source = r.source as 'group_offer' | 'route_request'

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
    planPassengerCount != null ? { passengerCount: planPassengerCount } : null

  return {
    id: r.id as string,
    source,
    direction: source === 'group_offer' ? 'incoming' : 'outgoing',
    clientId: r.clientId as string,
    routeId: r.routeId as string,
    driverId: r.driverId as string,
    planId: (r.planId as string | null) ?? null,
    tripPrice: Number(r.tripPrice) || 0,
    status: r.status as string,
    note: (r.note as string | null) ?? undefined,
    createdAt: r.createdAt as string,
    counterparty,
    route,
    plan,
  }
}

export async function listClientInboxHydrated(
  clientId: string,
  statuses?: string[],
): Promise<HydratedClientRequestItem[]> {
  const statusFilter =
    statuses && statuses.length > 0
      ? `AND go.status IN (${statuses.map(() => '?').join(',')})`
      : ''
  const statusFilter2 =
    statuses && statuses.length > 0
      ? `AND rr.status IN (${statuses.map(() => '?').join(',')})`
      : ''
  const statusParams = statuses && statuses.length > 0 ? statuses : []

  const result = await query(
    `
    SELECT 'group_offer' AS source,
           go.id, go.client_id, go.route_id, go.driver_id, go.plan_id,
           go.trip_price, go.status, go.created_at, NULL AS note,
           r.origin AS route_origin, r.destination AS route_destination,
           r.departure_window_start_date AS route_departure,
           r.departure_window_end_date AS route_departure_end,
           p.passenger_count AS plan_passenger_count,
           u.id AS cp_id, u.display_name AS cp_display_name,
           u.avatar_url AS cp_avatar_url, u.rating_avg AS cp_rating_avg,
           u.trip_count AS cp_trip_count, u.verification_status AS cp_verification_status
    FROM group_offers go
    JOIN routes r ON r.id = go.route_id
    JOIN users  u ON u.id = go.driver_id
    LEFT JOIN plans p ON p.id = go.plan_id
    WHERE go.client_id = ?
      ${statusFilter}
      AND r.status NOT IN ('completed', 'canceled')
      AND (p.id IS NULL OR p.status NOT IN ('completed', 'canceled'))
    UNION ALL
    SELECT 'route_request',
           rr.id, rr.client_id, rr.route_id, rr.driver_id, rr.plan_id,
           rr.trip_price, rr.status, rr.created_at, rr.note,
           r.origin, r.destination, r.departure_window_start_date, r.departure_window_end_date,
           p.passenger_count,
           u.id, u.display_name, u.avatar_url, u.rating_avg,
           u.trip_count, u.verification_status
    FROM route_requests rr
    JOIN routes r ON r.id = rr.route_id
    JOIN users  u ON u.id = rr.driver_id
    LEFT JOIN plans p ON p.id = rr.plan_id
    WHERE rr.client_id = ?
      ${statusFilter2}
      AND r.status NOT IN ('completed', 'canceled')
      AND (p.id IS NULL OR p.status NOT IN ('completed', 'canceled'))
    ORDER BY created_at DESC
    `,
    [clientId, ...statusParams, clientId, ...statusParams],
  )

  return result.rows.map(mapRow)
}
