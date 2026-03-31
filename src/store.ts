import { query, withTransaction } from './db/connection';
import { toCamelCase, normalizeUtc } from './db/utils';
import { HttpError } from './http-error';
import { User, Car, Route, Plan, GroupRequest, GroupOffer, SearchRequest, SavedLocation } from './types/entities';
import {
  BootstrapResult,
  CreatePlanPayload,
  CreateRoutePayload,
  DemandGroupSummary,
  UpdatePlanPayload,
  UpdateRoutePayload,
} from './types/payloads';

// --- Helpers ---

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`;
}

export function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function listByColumn<T>(table: string, column: string, mapFn: (row: Record<string, unknown>) => T | null = toCamelCase) {
  return async (value: string | number): Promise<T[]> => {
    const result = await query(`SELECT * FROM ${table} WHERE ${column} = $1`, [value]);
    return result.rows.map(mapFn).filter(Boolean) as T[];
  };
}

const CAR_COLORS: Record<string, string> = {
  'Xanh dương': '#006AF5',
  Trắng: '#FFFFFF',
  Đen: '#1A1A1A',
  Đỏ: '#CC0000',
  'Xanh lá': '#00C853',
  Cam: '#FFA000',
  Tím: '#9C27B0',
  Nâu: '#795548',
  Bạc: '#C0C0C0',
  'Xanh đậm': '#1565C0',
  Xám: '#757575',
};

export function mapCar(row: Record<string, unknown>): Car & { colorHex?: string } {
  const c = toCamelCase<Car & { colorHex?: string }>(row);
  if (!c) throw new Error('Cannot map null row to Car');
  if (c.color) c.colorHex = CAR_COLORS[c.color] || c.color;
  return c;
}

/**
 * Generic dynamic-update for any table. Builds a parameterized UPDATE from
 * a camelCase data object, stringifying any keys listed in jsonFields.
 */
export async function dynamicUpdate<T>(
  table: string,
  id: string,
  data: Record<string, any>,
  jsonFields: string[] = []
): Promise<T | null> {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (keys.length === 0) {
    const existing = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return toCamelCase<T>(existing.rows[0]);
  }

  const setClauses = keys.map((key, idx) => `${toSnakeCase(key)} = $${idx + 2}`);
  const timeFields = [
    'departureTime',
    'windowStart',
    'windowEnd',
    'departureBlockStart',
    'departureBlockEnd',
  ];
  const vals = keys.map((k) => {
    if (jsonFields.includes(k)) return JSON.stringify(data[k]);
    if (timeFields.includes(k) && data[k]) return new Date(data[k]).toISOString();
    return data[k];
  });

  const result = await query(
    `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...vals]
  );
  return toCamelCase<T>(result.rows[0]);
}

// --- Notifications ---

export interface NotificationPayload {
  type: string;
  recipientId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

const notifications: NotificationPayload[] = [];

export function emitNotification(type: string, recipientId: string, data: Record<string, unknown>): void {
  notifications.push({
    type,
    recipientId,
    data,
    createdAt: new Date().toISOString(),
  });
}

export function listNotifications(): NotificationPayload[] {
  return [...notifications];
}

// --- User ---

export async function getUser(userId: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
  return toCamelCase<User>(result.rows[0]);
}

export async function setUserMode(userId: string, mode: string): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  const result = await query(
    'UPDATE users SET preferred_mode = $1, mode_selected_at = NOW() WHERE id = $2 RETURNING preferred_mode, mode_selected_at',
    [mode, userId]
  );
  if (result.rowCount === 0) return null;
  return toCamelCase<{ preferredMode: string; modeSelectedAt: string }>(result.rows[0]);
}

export async function getUserMode(userId: string): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  const result = await query(
    'SELECT preferred_mode, mode_selected_at FROM users WHERE id = $1',
    [userId]
  );
  if (result.rowCount === 0) return null;
  return toCamelCase<{ preferredMode: string; modeSelectedAt: string }>(result.rows[0]);
}

export async function bootstrapUser(mauid: string, displayName?: string, avatarUrl?: string): Promise<BootstrapResult> {
  // Look up existing user by mauid
  const existing = await query('SELECT * FROM users WHERE mauid = $1', [mauid]);
  if (existing.rows.length > 0) {
    // Update display fields on subsequent bootstrap calls
    const updated = await query(
      `UPDATE users SET display_name = $1, avatar_url = $2 WHERE mauid = $3 RETURNING *`,
      [displayName || existing.rows[0].display_name, avatarUrl ?? existing.rows[0].avatar_url, mauid]
    );
    const user = toCamelCase<User>(updated.rows[0]);
    if (!user) throw new Error('Failed to update user');
    return { user, wasCreated: false };
  }

  // Create new user with auto-generated UUID id
  const result = await query(
    `
    INSERT INTO users (mauid, display_name, avatar_url, role, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING *
  `,
    [mauid, displayName || '', avatarUrl || '', 'client']
  );
  const user = toCamelCase<User>(result.rows[0]);
  if (!user) throw new Error('Failed to bootstrap user');
  return { user, wasCreated: true };
}

// --- Car ---

export async function createCar(ownerId: string, data: Record<string, any>): Promise<Car & { colorHex?: string }> {
  const result = await query(
    `
    INSERT INTO cars (id, owner_id, nickname, plate_number_masked, plate_number_full, brand, model, color, seat_capacity, verification_status, photos, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    RETURNING *
  `,
    [
      generateId('car'),
      ownerId,
      data.nickname,
      data.plateNumberMasked,
      data.plateNumberFull,
      data.brand,
      data.model,
      data.color,
      data.seatCapacity,
      data.verificationStatus || 'unverified',
      JSON.stringify(data.photos || []),
    ]
  );
  return mapCar(result.rows[0]);
}

export async function listCarsByOwner(ownerId: string): Promise<(Car & { colorHex?: string })[]> {
  const result = await query('SELECT * FROM cars WHERE owner_id = $1', [ownerId]);
  return result.rows.map(mapCar);
}

export async function updateCar(id: string, data: Record<string, any>): Promise<(Car & { colorHex?: string }) | null> {
  const result = await dynamicUpdate<Car & { colorHex?: string }>('cars', id, data, ['photos']);
  if (result && result.color) {
    result.colorHex = CAR_COLORS[result.color] || result.color;
  }
  return result;
}

export async function deleteCar(id: string): Promise<boolean> {
  const result = await query('DELETE FROM cars WHERE id = $1 RETURNING id', [id]);
  return result.rowCount !== null && result.rowCount > 0;
}

// --- Route ---

function extractWardFields(data: Record<string, any>, prefix: string, geoObj?: Record<string, any>) {
  const wardId = data[`${prefix}WardId`] || geoObj?.ward_id || '';
  const provinceId = data[`${prefix}ProvinceId`] || geoObj?.province_id || '';
  const wardKey = data[`${prefix}WardKey`] || (wardId && provinceId ? `${wardId}_${provinceId}` : '');
  return { wardId, provinceId, wardKey };
}

export async function createRoute(driverId: string, data: CreateRoutePayload): Promise<Route> {
  const origin = extractWardFields(data, 'origin', data.origin);
  const dest = extractWardFields(data, 'destination', data.destination);
  const departureWindow = computeDepartureBlock(data.departureTime);

  const res = await query(
    `
    INSERT INTO routes (
      id, driver_id, car_id, origin, destination, 
      origin_ward_key, origin_ward_id, origin_province_id,
      destination_ward_key, destination_ward_id, destination_province_id,
      service_date, departure_time, window_start, window_end, 
      trip_price, notes, status, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
    RETURNING *
  `,
    [
      generateId('route'),
      driverId,
      data.carId,
      JSON.stringify(data.origin),
      JSON.stringify(data.destination),
      origin.wardKey,
      origin.wardId,
      origin.provinceId,
      dest.wardKey,
      dest.wardId,
      dest.provinceId,
      data.serviceDate,
      normalizeUtc(data.departureTime),
      data.windowStart
        ? normalizeUtc(data.windowStart)
        : departureWindow.start,
      data.windowEnd
        ? normalizeUtc(data.windowEnd)
        : departureWindow.end,
      data.tripPrice,
      data.notes || '',
      data.status || 'draft',
    ]
  );
  const route = toCamelCase<Route>(res.rows[0]);
  if (!route) throw new Error('Failed to create route');
  return route;
}

export const listRoutesByDriver = listByColumn<Route>('routes', 'driver_id');

export async function getRoute(id: string): Promise<Route | null> {
  const result = await query('SELECT * FROM routes WHERE id = $1', [id]);
  return toCamelCase<Route>(result.rows[0]);
}

export async function updateRoute(id: string, data: UpdateRoutePayload): Promise<Route | null> {
  return dynamicUpdate<Route>('routes', id, data, ['origin', 'destination']);
}

export async function listAllRoutes(): Promise<Route[]> {
  const result = await query('SELECT * FROM routes');
  return result.rows.map((row: Record<string, unknown>) => toCamelCase<Route>(row)).filter(Boolean) as Route[];
}

// --- Plan ---

export async function createPlan(clientId: string, data: CreatePlanPayload): Promise<Plan> {
  const res = await query(
    `
    INSERT INTO plans (id, client_id, pickup, dropoff, pickup_ward_id, dropoff_ward_id, pickup_ward_key, dropoff_ward_key, pickup_province_id, dropoff_province_id, service_date, departure_block_start, departure_block_end, passenger_count, publish_mode, notes, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
    RETURNING *
  `,
    [
      generateId('plan'),
      clientId,
      JSON.stringify(data.pickup),
      JSON.stringify(data.dropoff),
      data.pickupWardId,
      data.dropoffWardId,
      data.pickupWardKey,
      data.dropoffWardKey,
      data.pickupProvinceId,
      data.dropoffProvinceId,
      data.serviceDate,
      normalizeUtc(data.departureBlockStart),
      normalizeUtc(data.departureBlockEnd),
      data.passengerCount,
      data.publishMode,
      data.notes || '',
      data.status || 'published',
    ]
  );
  const plan = toCamelCase<Plan>(res.rows[0]);
  if (!plan) throw new Error('Failed to create plan');
  return plan;
}

export async function getPlan(id?: string): Promise<Plan | null> {
  if (!id) return null;
  const result = await query('SELECT * FROM plans WHERE id = $1', [id]);
  return toCamelCase<Plan>(result.rows[0]);
}

export async function updatePlan(id: string, data: UpdatePlanPayload): Promise<Plan | null> {
  return dynamicUpdate<Plan>('plans', id, data, ['pickup', 'dropoff']);
}

export const listPlansByClient = listByColumn<Plan>('plans', 'client_id');

// --- Departure Block ---

export function computeDepartureBlock(departureTime: string | Date): { start: string; end: string } {
  const dt = new Date(departureTime);
  const minutes = dt.getMinutes();
  const blockStart = new Date(dt);
  blockStart.setMinutes(minutes < 30 ? 0 : 30, 0, 0);
  const blockEnd = new Date(blockStart);
  blockEnd.setMinutes(blockStart.getMinutes() + 30);
  return {
    start: blockStart.toISOString(),
    end: blockEnd.toISOString(),
  };
}

// --- Demand Groups ---

function buildGroupKey(tp: Plan): string {
  // `toCamelCase` maps pg Dates to canonical ISO strings, but if
  // something bypassed it and sent +07:00, force it to canonical UTC
  const svcDate =
    typeof tp.serviceDate === 'string' && tp.serviceDate.includes('T')
      ? new Date(tp.serviceDate).toISOString().split('T')[0]
      : tp.serviceDate;
  const dbs = normalizeUtc(tp.departureBlockStart);

  const pickupKey = tp.pickupWardKey || tp.pickupWardId;
  const dropoffKey = tp.dropoffWardKey || tp.dropoffWardId;
  return `${svcDate}|${pickupKey}|${dropoffKey}|${dbs}`;
}

export async function deriveDemandGroups(): Promise<DemandGroupSummary[]> {
  const grouped = new Map<string, DemandGroupSummary>();

  const result = await query(
    'SELECT * FROM plans WHERE publish_mode = $1 AND status = $2',
    ['grouped', 'published']
  );
  const activePlans = result.rows.map((row: Record<string, unknown>) => toCamelCase<Plan>(row)).filter(Boolean) as Plan[];

  for (const tp of activePlans) {
    const key = buildGroupKey(tp);
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `dg-${key}`,
        serviceDate: tp.serviceDate,
        pickupWardId: tp.pickupWardId,
        dropoffWardId: tp.dropoffWardId,
        pickupWardKey: tp.pickupWardKey,
        dropoffWardKey: tp.dropoffWardKey,
        pickupProvinceId: tp.pickupProvinceId,
        dropoffProvinceId: tp.dropoffProvinceId,
        departureBlockStart: tp.departureBlockStart,
        departureBlockEnd: tp.departureBlockEnd,
        memberCount: 0,
        totalPassengerCount: 0,
        memberPlanIds: [],
        pickup:
          typeof tp.pickup === 'string' ? JSON.parse(tp.pickup) : tp.pickup,
        dropoff:
          typeof tp.dropoff === 'string' ? JSON.parse(tp.dropoff) : tp.dropoff,
        clientIds: [],
      });
    }
    const group = grouped.get(key);
    if (!group) continue;
    group.memberCount += 1;
    group.totalPassengerCount += tp.passengerCount;
    group.memberPlanIds.push(tp.id);
    group.clientIds.push(tp.clientId);
  }

  return [...grouped.values()];
}

export async function getDemandGroup(groupId: string): Promise<DemandGroupSummary | null> {
  const groups = await deriveDemandGroups();
  return groups.find((g) => g.id === groupId) || null;
}

export async function getDemandGroupMembers(groupId: string): Promise<Plan[] | null> {
  const group = await getDemandGroup(groupId);
  if (!group) return null;

  const result = await query(
    'SELECT * FROM plans WHERE id = ANY($1::varchar[])',
    [group.memberPlanIds]
  );
  return result.rows.map((row: Record<string, unknown>) => toCamelCase<Plan>(row)).filter(Boolean) as Plan[];
}

// --- Route Availability ---

const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE route_id = $1 AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM search_requests WHERE route_id = $1 AND status = 'accepted'
`;

export async function checkRouteAvailability(executor: { query: (sql: string, params: any[]) => Promise<any> }, routeId: string): Promise<boolean> {
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId]);
  return result.rowCount === 0;
}

export async function isRouteAvailable(routeId: string): Promise<boolean> {
  return checkRouteAvailability({ query }, routeId);
}

// --- Group Request Orchestration ---

export async function createGroupRequest(driverId: string, routeId: string, demandGroupId: string, note?: string): Promise<{ groupRequest: GroupRequest; offers: GroupOffer[] }> {
  const resData = await withTransaction(async (tx) => {
    // Acquire a lock on the route so concurrent requests won't conflict
    const routeRes = await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [routeId]);
    const route = toCamelCase<Route>(routeRes.rows[0]);
    if (!route) throw new Error('Route not found');

    if (!(await checkRouteAvailability(tx, routeId))) {
      throw new Error('Route is not available — already has an accepted client');
    }

    const group = await getDemandGroup(demandGroupId);
    if (!group) throw new Error('Demand group not found');

    const greqId = generateId('greq');

    const greqRes = await tx.query(
      `
      INSERT INTO group_requests (id, driver_id, route_id, demand_group_id, note, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `,
      [greqId, driverId, routeId, demandGroupId, note || '', 'pending']
    );

    const greq = toCamelCase<GroupRequest>(greqRes.rows[0]);
    if (!greq) throw new Error('Failed to create group request');
    const createdOffers: GroupOffer[] = [];

    for (const tpId of group.memberPlanIds) {
      const tpRes = await tx.query('SELECT * FROM plans WHERE id = $1', [tpId]);
      const tp = toCamelCase<Plan>(tpRes.rows[0]);
      if (!tp) continue;
      const offerId = generateId('goffer');

      const offerRes = await tx.query(
        `
        INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `,
        [offerId, greq.id, routeId, driverId, tp.clientId, tpId, route.tripPrice, 'pending']
      );

      const offer = toCamelCase<GroupOffer>(offerRes.rows[0]);
      if (offer) createdOffers.push(offer);
    }

    return { groupRequest: greq, offers: createdOffers };
  });

  // Outside transaction
  for (const offer of resData.offers) {
    emitNotification('group_offer_received', offer.clientId, {
      groupOfferId: offer.id,
      groupRequestId: resData.groupRequest.id,
      driverId,
      routeId,
    });
  }

  return resData;
}

export async function acceptGroupOffer(offerId: string): Promise<GroupOffer> {
  const result = await withTransaction(async (tx) => {
    let offerRes = await tx.query('SELECT * FROM group_offers WHERE id = $1 FOR UPDATE', [offerId]);
    const offer = toCamelCase<GroupOffer>(offerRes.rows[0]);
    if (!offer) throw new Error('Group offer not found');
    if (offer.status !== 'pending') {
      throw new Error(`Cannot accept offer in status: ${offer.status}`);
    }

    // Lock route
    await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [offer.routeId]);

    if (!(await checkRouteAvailability(tx, offer.routeId))) {
      throw new Error('Route is no longer available — another client was accepted first');
    }

    offerRes = await tx.query("UPDATE group_offers SET status = 'accepted' WHERE id = $1 RETURNING *", [offerId]);
    const updatedOffer = toCamelCase<GroupOffer>(offerRes.rows[0]);
    if (!updatedOffer) throw new Error('Failed to update group offer');

    const siblingsRes = await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND id != $2 AND status = 'pending' RETURNING *",
      [offer.groupRequestId, offerId]
    );
    const siblings = siblingsRes.rows.map((row: Record<string, unknown>) => toCamelCase<GroupOffer>(row)).filter(Boolean) as GroupOffer[];

    await tx.query("UPDATE search_requests SET status = 'closed' WHERE route_id = $1 AND status = 'pending'", [offer.routeId]);

    return { updatedOffer, siblings, offer };
  });

  for (const sibling of result.siblings) {
    emitNotification('sibling_offer_closed', sibling.clientId, {
      groupOfferId: sibling.id,
      reason: 'another_client_accepted',
    });
  }

  emitNotification('group_offer_accepted', result.offer.driverId, {
    groupOfferId: offerId,
    clientId: result.offer.clientId,
    routeId: result.offer.routeId,
  });

  return result.updatedOffer;
}

export async function declineGroupOffer(offerId: string): Promise<GroupOffer> {
  const offerRes = await query('SELECT * FROM group_offers WHERE id = $1', [offerId]);
  const offer = toCamelCase<GroupOffer>(offerRes.rows[0]);
  if (!offer) throw new Error('Group offer not found');
  if (offer.status !== 'pending') {
    throw new Error(`Cannot decline offer in status: ${offer.status}`);
  }

  const updatedRes = await query("UPDATE group_offers SET status = 'declined' WHERE id = $1 RETURNING *", [offerId]);
  const updated = toCamelCase<GroupOffer>(updatedRes.rows[0]);
  if (!updated) throw new Error('Failed to update group offer');

  emitNotification('group_offer_declined', updated.driverId, {
    groupOfferId: offerId,
    clientId: updated.clientId,
  });

  return updated;
}

export async function cancelGroupRequest(requestId: string): Promise<GroupRequest> {
  const result = await withTransaction(async (tx) => {
    const greqRes = await tx.query('SELECT * FROM group_requests WHERE id = $1 FOR UPDATE', [requestId]);
    let greq = toCamelCase<GroupRequest>(greqRes.rows[0]);
    if (!greq) throw new Error('Group request not found');
    if (greq.status !== 'pending') {
      throw new Error(`Cannot cancel request in status: ${greq.status}`);
    }

    const updatedRes = await tx.query("UPDATE group_requests SET status = 'canceled' WHERE id = $1 RETURNING *", [requestId]);
    greq = toCamelCase<GroupRequest>(updatedRes.rows[0]);
    if (!greq) throw new Error('Failed to cancel group request');

    const offersRes = await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND status = 'pending' RETURNING *",
      [requestId]
    );
    const offers = offersRes.rows.map((row: Record<string, unknown>) => toCamelCase<GroupOffer>(row)).filter(Boolean) as GroupOffer[];
    return { greq, offers };
  });

  for (const offer of result.offers) {
    emitNotification('sibling_offer_closed', offer.clientId, {
      groupOfferId: offer.id,
      reason: 'group_request_canceled',
    });
  }

  emitNotification('group_request_canceled', result.greq.driverId, {
    groupRequestId: requestId,
  });

  return result.greq;
}

export async function createSearchRequest(clientId: string, planId: string | null, routeId: string, note?: string): Promise<SearchRequest> {
  const resData = await withTransaction(async (tx) => {
    if (planId) {
      const tpRes = await tx.query('SELECT * FROM plans WHERE id = $1', [planId]);
      const tp = toCamelCase<Plan>(tpRes.rows[0]);
      if (!tp) {
        throw new HttpError(400, 'Plan not found');
      }
    }

    const routeRes = await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [routeId]);
    const route = toCamelCase<Route>(routeRes.rows[0]);
    if (!route) throw new Error('Route not found');

    if (!(await checkRouteAvailability(tx, routeId))) {
      throw new Error('Route is not available — already has an accepted client');
    }

    const sreqId = generateId('sreq');

    const sreqRes = await tx.query(
      `
      INSERT INTO search_requests (id, client_id, plan_id, route_id, driver_id, trip_price, note, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `,
      [sreqId, clientId, planId || null, routeId, route.driverId, route.tripPrice, note || '', 'pending']
    );

    return { sreq: toCamelCase<SearchRequest>(sreqRes.rows[0]), route };
  });

  if (!resData.sreq) throw new Error('Failed to create search request');

  emitNotification('search_request_received', resData.route.driverId, {
    searchRequestId: resData.sreq.id,
    clientId,
    routeId,
  });

  return resData.sreq;
}

export async function acceptSearchRequest(requestId: string): Promise<SearchRequest> {
  const sreq = await withTransaction(async (tx) => {
    const sreqRes = await tx.query('SELECT * FROM search_requests WHERE id = $1 FOR UPDATE', [requestId]);
    let sreq = toCamelCase<SearchRequest>(sreqRes.rows[0]);
    if (!sreq) throw new Error('Search request not found');
    if (sreq.status !== 'pending') {
      throw new Error(`Cannot accept search request in status: ${sreq.status}`);
    }

    await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [sreq.routeId]);

    if (!(await checkRouteAvailability(tx, sreq.routeId))) {
      throw new Error('Route is no longer available — another client was accepted first');
    }

    const updatedRes = await tx.query("UPDATE search_requests SET status = 'accepted' WHERE id = $1 RETURNING *", [requestId]);
    sreq = toCamelCase<SearchRequest>(updatedRes.rows[0]);
    if (!sreq) throw new Error('Failed to accept search request');

    await tx.query("UPDATE group_offers SET status = 'closed' WHERE route_id = $1 AND status = 'pending'", [sreq.routeId]);
    await tx.query("UPDATE search_requests SET status = 'closed' WHERE route_id = $1 AND id != $2 AND status = 'pending'", [sreq.routeId, requestId]);

    return sreq;
  });

  emitNotification('search_request_accepted', sreq.clientId, {
    searchRequestId: requestId,
    routeId: sreq.routeId,
    driverId: sreq.driverId,
  });

  return sreq;
}

export async function declineSearchRequest(requestId: string): Promise<SearchRequest> {
  const sreqRes = await query('SELECT * FROM search_requests WHERE id = $1', [requestId]);
  const sreq = toCamelCase<SearchRequest>(sreqRes.rows[0]);
  if (!sreq) throw new Error('Search request not found');
  if (sreq.status !== 'pending') {
    throw new Error(`Cannot decline search request in status: ${sreq.status}`);
  }
  const updatedRes = await query("UPDATE search_requests SET status = 'declined' WHERE id = $1 RETURNING *", [requestId]);
  const updated = toCamelCase<SearchRequest>(updatedRes.rows[0]);
  if (!updated) throw new Error('Failed to decline search request');

  emitNotification('search_request_declined', updated.clientId, {
    searchRequestId: requestId,
  });

  return updated;
}

export const listGroupRequestsByDriver = listByColumn<GroupRequest>('group_requests', 'driver_id');
export const listGroupOffersByClient = listByColumn<GroupOffer>('group_offers', 'client_id');
export const listSearchRequestsByDriver = listByColumn<SearchRequest>('search_requests', 'driver_id');
export const listSearchRequestsByClient = listByColumn<SearchRequest>('search_requests', 'client_id');
export const listSearchRequestsByRoute = listByColumn<SearchRequest>('search_requests', 'route_id');
export const listGroupOffersByRoute = listByColumn<GroupOffer>('group_offers', 'route_id');

// --- Deprecated: saved locations ---

function parseLocationRow(row: Record<string, unknown>): SavedLocation {
  const loc = toCamelCase<SavedLocation>(row);
  if (!loc) throw new Error('Cannot map null row to SavedLocation');
  loc.lat = parseFloat(String(loc.lat));
  loc.lng = parseFloat(String(loc.lng));
  return loc;
}

export async function createSavedLocation(payload: { label: string; lat: number; lng: number }): Promise<SavedLocation> {
  const result = await query('SELECT COUNT(*) FROM saved_locations');
  if (parseInt(result.rows[0].count, 10) >= 10) {
    throw new Error('Maximum 10 saved locations allowed');
  }

  const insertRes = await query(
    `
    INSERT INTO saved_locations (id, label, lat, lng, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING *
  `,
    [generateId('savedloc'), payload.label, payload.lat, payload.lng]
  );

  return parseLocationRow(insertRes.rows[0]);
}

export async function listSavedLocations(): Promise<SavedLocation[]> {
  const result = await query('SELECT * FROM saved_locations');
  return result.rows.map(parseLocationRow);
}

export async function deleteSavedLocation(id: string): Promise<boolean> {
  const result = await query('DELETE FROM saved_locations WHERE id = $1 RETURNING id', [id]);
  return result.rowCount !== null && result.rowCount > 0;
}
