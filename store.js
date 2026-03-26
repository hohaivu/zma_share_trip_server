// ─── Phase 2 Store ────────────────────────────────────────────────────────────
// Postgres-backed store aligned to PRD v1.1.
// Demand groups are computed on-read. Request orchestration is transactional.
// ──────────────────────────────────────────────────────────────────────────────

const { query, withTransaction } = require('./db/connection')

// ─── Shared Helpers ────────────────────────────────────────────────────────────

function generateId(prefix) {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

function toCamelCase(row) {
  if (!row) return null
  const res = {}
  for (const key in row) {
    const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase())
    res[camelKey] = row[key]
  }
  return res
}

function toSnakeCase(key) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/**
 * Generic dynamic-update for any table. Builds a parameterized UPDATE from
 * a camelCase data object, stringifying any keys listed in jsonFields.
 */
async function dynamicUpdate(table, id, data, jsonFields = []) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined)
  if (keys.length === 0) {
    const existing = await query(`SELECT * FROM ${table} WHERE id = $1`, [id])
    return toCamelCase(existing.rows[0])
  }

  const setClauses = keys.map((key, idx) => `${toSnakeCase(key)} = $${idx + 2}`)
  const vals = keys.map((k) =>
    jsonFields.includes(k) ? JSON.stringify(data[k]) : data[k],
  )

  const result = await query(
    `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...vals],
  )
  return toCamelCase(result.rows[0])
}

// ─── Notifications (lightweight hook payloads) ─────────────────────────────────

const notifications = []

function emitNotification(type, recipientId, data) {
  notifications.push({
    type,
    recipientId,
    data,
    createdAt: new Date().toISOString(),
  })
}

function listNotifications() {
  return [...notifications]
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — User
// ═══════════════════════════════════════════════════════════════════════════════

async function getUser(userId) {
  const result = await query('SELECT * FROM users WHERE id = $1', [userId])
  return toCamelCase(result.rows[0])
}

async function setUserMode(userId, mode) {
  const result = await query(
    'UPDATE users SET preferred_mode = $1, mode_selected_at = NOW() WHERE id = $2 RETURNING preferred_mode, mode_selected_at',
    [mode, userId],
  )
  if (result.rowCount === 0) return null
  return toCamelCase(result.rows[0])
}

async function getUserMode(userId) {
  const result = await query(
    'SELECT preferred_mode, mode_selected_at FROM users WHERE id = $1',
    [userId],
  )
  if (result.rowCount === 0) return null
  return toCamelCase(result.rows[0])
}

async function findOrCreateUser(zaloId, displayName, avatarUrl) {
  const result = await query(
    `
    INSERT INTO users (id, zalo_id, display_name, avatar_url, role, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (zalo_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url
    RETURNING *
  `,
    [zaloId, zaloId, displayName || '', avatarUrl || '', 'client'],
  )
  return toCamelCase(result.rows[0])
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Car (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

async function createCar(ownerId, data) {
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
    ],
  )
  return toCamelCase(result.rows[0])
}

async function listCarsByOwner(ownerId) {
  const result = await query('SELECT * FROM cars WHERE owner_id = $1', [
    ownerId,
  ])
  return result.rows.map(toCamelCase)
}

async function updateCar(id, data) {
  return dynamicUpdate('cars', id, data, ['photos'])
}

async function deleteCar(id) {
  const result = await query('DELETE FROM cars WHERE id = $1 RETURNING id', [
    id,
  ])
  return result.rowCount > 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Route (Phase 2: tripPrice, serviceDate)
// ═══════════════════════════════════════════════════════════════════════════════

async function createRoute(driverId, data) {
  const res = await query(
    `
    INSERT INTO routes (id, driver_id, car_id, origin, destination, service_date, departure_time, window_start, window_end, trip_price, notes, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    RETURNING *
  `,
    [
      generateId('route'),
      driverId,
      data.carId,
      JSON.stringify(data.origin),
      JSON.stringify(data.destination),
      data.serviceDate,
      data.departureTime,
      data.windowStart,
      data.windowEnd,
      data.tripPrice,
      data.notes || '',
      data.status || 'draft',
    ],
  )
  return toCamelCase(res.rows[0])
}

async function listRoutesByDriver(driverId) {
  const result = await query('SELECT * FROM routes WHERE driver_id = $1', [
    driverId,
  ])
  return result.rows.map(toCamelCase)
}

async function getRoute(id) {
  const result = await query('SELECT * FROM routes WHERE id = $1', [id])
  return toCamelCase(result.rows[0])
}

async function updateRoute(id, data) {
  return dynamicUpdate('routes', id, data, ['origin', 'destination'])
}

async function listAllRoutes() {
  const result = await query('SELECT * FROM routes')
  return result.rows.map(toCamelCase)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Trip Plan (replaces demand CRUD)
// ═══════════════════════════════════════════════════════════════════════════════

async function createTripPlan(clientId, data) {
  const res = await query(
    `
    INSERT INTO trip_plans (id, client_id, pickup, dropoff, pickup_ward_id, dropoff_ward_id, pickup_ward_key, dropoff_ward_key, pickup_province_id, dropoff_province_id, service_date, departure_block_start, departure_block_end, passenger_count, publish_mode, notes, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
    RETURNING *
  `,
    [
      generateId('tripPlan'),
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
      data.departureBlockStart,
      data.departureBlockEnd,
      data.passengerCount,
      data.publishMode,
      data.notes || '',
      data.status || 'published',
    ],
  )
  return toCamelCase(res.rows[0])
}

async function getTripPlan(id) {
  const result = await query('SELECT * FROM trip_plans WHERE id = $1', [id])
  return toCamelCase(result.rows[0])
}

async function updateTripPlan(id, data) {
  return dynamicUpdate('trip_plans', id, data, ['pickup', 'dropoff'])
}

async function listTripPlansByClient(clientId) {
  const result = await query('SELECT * FROM trip_plans WHERE client_id = $1', [
    clientId,
  ])
  return result.rows.map(toCamelCase)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Departure Block
// ═══════════════════════════════════════════════════════════════════════════════

function computeDepartureBlock(departureTime) {
  const dt = new Date(departureTime)
  const minutes = dt.getMinutes()
  const blockStart = new Date(dt)
  blockStart.setMinutes(minutes < 30 ? 0 : 30, 0, 0)
  const blockEnd = new Date(blockStart)
  blockEnd.setMinutes(blockStart.getMinutes() + 30)
  return {
    start: blockStart.toISOString(),
    end: blockEnd.toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Demand Groups (computed on-read)
// ═══════════════════════════════════════════════════════════════════════════════

function buildGroupKey(tp) {
  // Convert dates to string because pg returns Date objects
  const svcDate =
    tp.serviceDate instanceof Date
      ? tp.serviceDate.toISOString().split('T')[0]
      : tp.serviceDate
  const dbs =
    tp.departureBlockStart instanceof Date
      ? tp.departureBlockStart.toISOString()
      : tp.departureBlockStart
  const pickupKey = tp.pickupWardKey || tp.pickupWardId
  const dropoffKey = tp.dropoffWardKey || tp.dropoffWardId
  return `${svcDate}|${pickupKey}|${dropoffKey}|${dbs}`
}

async function deriveDemandGroups() {
  const grouped = new Map()

  const result = await query(
    'SELECT * FROM trip_plans WHERE publish_mode = $1 AND status = $2',
    ['grouped', 'published'],
  )
  const activePlans = result.rows.map(toCamelCase)

  for (const tp of activePlans) {
    const key = buildGroupKey(tp)
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
        memberTripPlanIds: [],
        pickup:
          typeof tp.pickup === 'string' ? JSON.parse(tp.pickup) : tp.pickup,
        dropoff:
          typeof tp.dropoff === 'string' ? JSON.parse(tp.dropoff) : tp.dropoff,
        clientIds: [],
      })
    }
    const group = grouped.get(key)
    group.memberCount += 1
    group.totalPassengerCount += tp.passengerCount
    group.memberTripPlanIds.push(tp.id)
    group.clientIds.push(tp.clientId)
  }

  return [...grouped.values()]
}

async function getDemandGroup(groupId) {
  const groups = await deriveDemandGroups()
  return groups.find((g) => g.id === groupId) || null
}

async function getDemandGroupMembers(groupId) {
  const group = await getDemandGroup(groupId)
  if (!group) return null

  const result = await query(
    'SELECT * FROM trip_plans WHERE id = ANY($1::varchar[])',
    [group.memberTripPlanIds],
  )
  return result.rows.map(toCamelCase)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Route Availability
// ═══════════════════════════════════════════════════════════════════════════════

const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE route_id = $1 AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM search_requests WHERE route_id = $1 AND status = 'accepted'
`

async function checkRouteAvailability(executor, routeId) {
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId])
  return result.rowCount === 0
}

async function isRouteAvailable(routeId) {
  return checkRouteAvailability({ query }, routeId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Group Request Orchestration
// ═══════════════════════════════════════════════════════════════════════════════

async function createGroupRequest(driverId, routeId, demandGroupId, note) {
  const resData = await withTransaction(async (tx) => {
    // Acquire a lock on the route so concurrent requests won't conflict
    const routeRes = await tx.query(
      'SELECT * FROM routes WHERE id = $1 FOR UPDATE',
      [routeId],
    )
    const route = toCamelCase(routeRes.rows[0])
    if (!route) throw new Error('Route not found')

    if (!(await checkRouteAvailability(tx, routeId))) {
      throw new Error('Route is not available — already has an accepted client')
    }

    const group = await getDemandGroup(demandGroupId)
    if (!group) throw new Error('Demand group not found')

    const greqId = generateId('greq')

    const greqRes = await tx.query(
      `
      INSERT INTO group_requests (id, driver_id, route_id, demand_group_id, note, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `,
      [greqId, driverId, routeId, demandGroupId, note || '', 'pending'],
    )

    const greq = toCamelCase(greqRes.rows[0])
    const createdOffers = []

    for (const tpId of group.memberTripPlanIds) {
      const tpRes = await tx.query('SELECT * FROM trip_plans WHERE id = $1', [
        tpId,
      ])
      const tp = toCamelCase(tpRes.rows[0])
      if (!tp) continue
      const offerId = generateId('goffer')

      const offerRes = await tx.query(
        `
        INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, trip_plan_id, trip_price, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `,
        [
          offerId,
          greq.id,
          routeId,
          driverId,
          tp.clientId,
          tpId,
          route.tripPrice,
          'pending',
        ],
      )

      const offer = toCamelCase(offerRes.rows[0])
      createdOffers.push(offer)
    }

    return { groupRequest: greq, offers: createdOffers }
  })

  // Outside transaction
  for (const offer of resData.offers) {
    emitNotification('group_offer_received', offer.clientId, {
      groupOfferId: offer.id,
      groupRequestId: resData.groupRequest.id,
      driverId,
      routeId,
    })
  }

  return resData
}

async function acceptGroupOffer(offerId) {
  const result = await withTransaction(async (tx) => {
    let offerRes = await tx.query(
      'SELECT * FROM group_offers WHERE id = $1 FOR UPDATE',
      [offerId],
    )
    const offer = toCamelCase(offerRes.rows[0])
    if (!offer) throw new Error('Group offer not found')
    if (offer.status !== 'pending') {
      throw new Error(`Cannot accept offer in status: ${offer.status}`)
    }

    // Lock route
    await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [
      offer.routeId,
    ])

    if (!(await checkRouteAvailability(tx, offer.routeId))) {
      throw new Error(
        'Route is no longer available — another client was accepted first',
      )
    }

    offerRes = await tx.query(
      "UPDATE group_offers SET status = 'accepted' WHERE id = $1 RETURNING *",
      [offerId],
    )
    const updatedOffer = toCamelCase(offerRes.rows[0])

    const siblingsRes = await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND id != $2 AND status = 'pending' RETURNING *",
      [offer.groupRequestId, offerId],
    )
    const siblings = siblingsRes.rows.map(toCamelCase)

    await tx.query(
      "UPDATE search_requests SET status = 'closed' WHERE route_id = $1 AND status = 'pending'",
      [offer.routeId],
    )

    return { updatedOffer, siblings, offer }
  })

  for (const sibling of result.siblings) {
    emitNotification('sibling_offer_closed', sibling.clientId, {
      groupOfferId: sibling.id,
      reason: 'another_client_accepted',
    })
  }

  emitNotification('group_offer_accepted', result.offer.driverId, {
    groupOfferId: offerId,
    clientId: result.offer.clientId,
    routeId: result.offer.routeId,
  })

  return result.updatedOffer
}

async function declineGroupOffer(offerId) {
  const offerRes = await query('SELECT * FROM group_offers WHERE id = $1', [
    offerId,
  ])
  let offer = toCamelCase(offerRes.rows[0])
  if (!offer) throw new Error('Group offer not found')
  if (offer.status !== 'pending') {
    throw new Error(`Cannot decline offer in status: ${offer.status}`)
  }

  const updatedRes = await query(
    "UPDATE group_offers SET status = 'declined' WHERE id = $1 RETURNING *",
    [offerId],
  )
  offer = toCamelCase(updatedRes.rows[0])

  emitNotification('group_offer_declined', offer.driverId, {
    groupOfferId: offerId,
    clientId: offer.clientId,
  })

  return offer
}

async function cancelGroupRequest(requestId) {
  const result = await withTransaction(async (tx) => {
    const greqRes = await tx.query(
      'SELECT * FROM group_requests WHERE id = $1 FOR UPDATE',
      [requestId],
    )
    let greq = toCamelCase(greqRes.rows[0])
    if (!greq) throw new Error('Group request not found')
    if (greq.status !== 'pending') {
      throw new Error(`Cannot cancel request in status: ${greq.status}`)
    }

    const updatedRes = await tx.query(
      "UPDATE group_requests SET status = 'canceled' WHERE id = $1 RETURNING *",
      [requestId],
    )
    greq = toCamelCase(updatedRes.rows[0])

    const offersRes = await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND status = 'pending' RETURNING *",
      [requestId],
    )
    const offers = offersRes.rows.map(toCamelCase)
    return { greq, offers }
  })

  for (const offer of result.offers) {
    emitNotification('sibling_offer_closed', offer.clientId, {
      groupOfferId: offer.id,
      reason: 'group_request_canceled',
    })
  }

  emitNotification('group_request_canceled', result.greq.driverId, {
    groupRequestId: requestId,
  })

  return result.greq
}

async function createSearchRequest(clientId, tripPlanId, routeId, note) {
  const resData = await withTransaction(async (tx) => {
    const tpRes = await tx.query('SELECT * FROM trip_plans WHERE id = $1', [
      tripPlanId,
    ])
    const tp = toCamelCase(tpRes.rows[0])
    if (!tp) throw new Error('Trip plan not found')
    if (tp.publishMode !== 'search_only') {
      throw new Error('Only search_only trip plans can create search requests')
    }

    const routeRes = await tx.query(
      'SELECT * FROM routes WHERE id = $1 FOR UPDATE',
      [routeId],
    )
    const route = toCamelCase(routeRes.rows[0])
    if (!route) throw new Error('Route not found')

    if (!(await checkRouteAvailability(tx, routeId))) {
      throw new Error('Route is not available — already has an accepted client')
    }

    const sreqId = generateId('sreq')

    const sreqRes = await tx.query(
      `
      INSERT INTO search_requests (id, client_id, trip_plan_id, route_id, driver_id, trip_price, note, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `,
      [
        sreqId,
        clientId,
        tripPlanId,
        routeId,
        route.driverId,
        route.tripPrice,
        note || '',
        'pending',
      ],
    )

    return { sreq: toCamelCase(sreqRes.rows[0]), route }
  })

  emitNotification('search_request_received', resData.route.driverId, {
    searchRequestId: resData.sreq.id,
    clientId,
    routeId,
  })

  return resData.sreq
}

async function acceptSearchRequest(requestId) {
  const sreq = await withTransaction(async (tx) => {
    const sreqRes = await tx.query(
      'SELECT * FROM search_requests WHERE id = $1 FOR UPDATE',
      [requestId],
    )
    let sreq = toCamelCase(sreqRes.rows[0])
    if (!sreq) throw new Error('Search request not found')
    if (sreq.status !== 'pending') {
      throw new Error(`Cannot accept search request in status: ${sreq.status}`)
    }

    await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [
      sreq.routeId,
    ])

    if (!(await checkRouteAvailability(tx, sreq.routeId))) {
      throw new Error(
        'Route is no longer available — another client was accepted first',
      )
    }

    const updatedRes = await tx.query(
      "UPDATE search_requests SET status = 'accepted' WHERE id = $1 RETURNING *",
      [requestId],
    )
    sreq = toCamelCase(updatedRes.rows[0])

    await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE route_id = $1 AND status = 'pending'",
      [sreq.routeId],
    )

    await tx.query(
      "UPDATE search_requests SET status = 'closed' WHERE route_id = $1 AND id != $2 AND status = 'pending'",
      [sreq.routeId, requestId],
    )

    return sreq
  })

  emitNotification('search_request_accepted', sreq.clientId, {
    searchRequestId: requestId,
    routeId: sreq.routeId,
    driverId: sreq.driverId,
  })

  return sreq
}

async function declineSearchRequest(requestId) {
  const sreqRes = await query('SELECT * FROM search_requests WHERE id = $1', [
    requestId,
  ])
  let sreq = toCamelCase(sreqRes.rows[0])
  if (!sreq) throw new Error('Search request not found')
  if (sreq.status !== 'pending') {
    throw new Error(`Cannot decline search request in status: ${sreq.status}`)
  }
  const updatedRes = await query(
    "UPDATE search_requests SET status = 'declined' WHERE id = $1 RETURNING *",
    [requestId],
  )
  sreq = toCamelCase(updatedRes.rows[0])

  emitNotification('search_request_declined', sreq.clientId, {
    searchRequestId: requestId,
  })

  return sreq
}

async function listGroupRequestsByDriver(driverId) {
  const res = await query('SELECT * FROM group_requests WHERE driver_id = $1', [
    driverId,
  ])
  return res.rows.map(toCamelCase)
}

async function listGroupOffersByClient(clientId) {
  const res = await query('SELECT * FROM group_offers WHERE client_id = $1', [
    clientId,
  ])
  return res.rows.map(toCamelCase)
}

async function listSearchRequestsByDriver(driverId) {
  const res = await query(
    'SELECT * FROM search_requests WHERE driver_id = $1',
    [driverId],
  )
  return res.rows.map(toCamelCase)
}

async function listSearchRequestsByClient(clientId) {
  const res = await query(
    'SELECT * FROM search_requests WHERE client_id = $1',
    [clientId],
  )
  return res.rows.map(toCamelCase)
}

async function listSearchRequestsByRoute(routeId) {
  const res = await query('SELECT * FROM search_requests WHERE route_id = $1', [
    routeId,
  ])
  return res.rows.map(toCamelCase)
}

async function listGroupOffersByRoute(routeId) {
  const res = await query('SELECT * FROM group_offers WHERE route_id = $1', [
    routeId,
  ])
  return res.rows.map(toCamelCase)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Deprecated template / saved-location (kept inert)
// ═══════════════════════════════════════════════════════════════════════════════

function parseLocationRow(row) {
  const loc = toCamelCase(row)
  loc.lat = parseFloat(loc.lat)
  loc.lng = parseFloat(loc.lng)
  return loc
}

async function createSavedLocation(payload) {
  const result = await query('SELECT COUNT(*) FROM saved_locations')
  if (parseInt(result.rows[0].count, 10) >= 10) {
    throw new Error('Maximum 10 saved locations allowed')
  }

  const insertRes = await query(
    `
    INSERT INTO saved_locations (id, label, lat, lng, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING *
  `,
    [generateId('savedloc'), payload.label, payload.lat, payload.lng],
  )

  return parseLocationRow(insertRes.rows[0])
}

async function listSavedLocations() {
  const result = await query('SELECT * FROM saved_locations')
  return result.rows.map(parseLocationRow)
}

async function deleteSavedLocation(id) {
  const result = await query(
    'DELETE FROM saved_locations WHERE id = $1 RETURNING id',
    [id],
  )
  return result.rowCount > 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // User
  getUser,
  findOrCreateUser,
  setUserMode,
  getUserMode,

  // Car
  createCar,
  listCarsByOwner,
  updateCar,
  deleteCar,

  // Route
  createRoute,
  listRoutesByDriver,
  getRoute,
  updateRoute,
  listAllRoutes,

  // Trip Plan
  createTripPlan,
  getTripPlan,
  updateTripPlan,
  listTripPlansByClient,

  // Departure Block
  computeDepartureBlock,

  // Demand Groups
  deriveDemandGroups,
  getDemandGroup,
  getDemandGroupMembers,

  // Route Availability
  isRouteAvailable,

  // Group Requests
  createGroupRequest,
  acceptGroupOffer,
  declineGroupOffer,
  cancelGroupRequest,

  // Search Requests
  createSearchRequest,
  acceptSearchRequest,
  declineSearchRequest,

  // List helpers
  listGroupRequestsByDriver,
  listGroupOffersByClient,
  listSearchRequestsByDriver,
  listSearchRequestsByClient,
  listSearchRequestsByRoute,
  listGroupOffersByRoute,

  // Notifications
  emitNotification,
  listNotifications,

  // Deprecated
  createSavedLocation,
  listSavedLocations,
  deleteSavedLocation,
}
