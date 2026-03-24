// ─── Phase 2 Store ────────────────────────────────────────────────────────────
// Demo-first in-memory store aligned to PRD v1.1.
// Demand groups are computed on-read. Request orchestration is synchronous.
// ──────────────────────────────────────────────────────────────────────────────

// ─── ID Generator ──────────────────────────────────────────────────────────────

let idCounter = 1000

function nextId(prefix) {
  idCounter += 1
  return `${prefix}-${idCounter}`
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

// ─── Seed Data ─────────────────────────────────────────────────────────────────

const users = new Map([
  [
    'driver-001',
    {
      id: 'driver-001',
      zaloId: 'zalo-driver-001',
      displayName: 'Tài xế 001',
      avatarUrl: '',
      verificationStatus: 'verified',
      ratingAvg: 4.8,
      tripCount: 112,
      role: 'driver',
      preferredMode: 'driver',
      modeSelectedAt: '2026-01-01T00:00:00.000Z',
      blockedUserIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  [
    'driver-002',
    {
      id: 'driver-002',
      zaloId: 'zalo-driver-002',
      displayName: 'Tài xế 002',
      avatarUrl: '',
      verificationStatus: 'verified',
      ratingAvg: 4.5,
      tripCount: 45,
      role: 'driver',
      preferredMode: 'driver',
      modeSelectedAt: '2026-01-02T00:00:00.000Z',
      blockedUserIds: [],
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  [
    'client-001',
    {
      id: 'client-001',
      zaloId: 'zalo-client-001',
      displayName: 'Hành khách 001',
      avatarUrl: '',
      verificationStatus: 'verified',
      ratingAvg: 4.7,
      tripCount: 52,
      role: 'client',
      preferredMode: 'client',
      modeSelectedAt: '2026-01-01T00:00:00.000Z',
      blockedUserIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  [
    'client-002',
    {
      id: 'client-002',
      zaloId: 'zalo-client-002',
      displayName: 'Hành khách 002',
      avatarUrl: '',
      verificationStatus: 'verified',
      ratingAvg: 4.9,
      tripCount: 30,
      role: 'client',
      preferredMode: 'client',
      modeSelectedAt: '2026-01-02T00:00:00.000Z',
      blockedUserIds: [],
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ],
])

const cars = new Map([
  [
    'car-001',
    {
      id: 'car-001',
      ownerId: 'driver-001',
      nickname: 'Xe gia đình',
      plateNumberMasked: '51A-***45',
      plateNumberFull: '51A-123.45',
      brand: 'Toyota',
      model: 'Vios',
      color: '#FFFFFF',
      seatCapacity: 5,
      verificationStatus: 'verified',
      photos: [],
      createdAt: '2026-01-03T00:00:00.000Z',
    },
  ],
  [
    'car-002',
    {
      id: 'car-002',
      ownerId: 'driver-002',
      nickname: 'Xe đi làm',
      plateNumberMasked: '59C-***78',
      plateNumberFull: '59C-456.78',
      brand: 'Honda',
      model: 'City',
      color: '#1A1A1A',
      seatCapacity: 5,
      verificationStatus: 'verified',
      photos: [],
      createdAt: '2026-01-04T00:00:00.000Z',
    },
  ],
])

// ─── Routes (Phase 2: tripPrice instead of availableSeats/pricePerSeat) ────────

const routes = new Map([
  [
    'route-001',
    {
      id: 'route-001',
      driverId: 'driver-001',
      carId: 'car-001',
      origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      serviceDate: '2030-03-20',
      departureTime: '2030-03-20T07:00:00.000Z',
      windowStart: '2030-03-20T06:45:00.000Z',
      windowEnd: '2030-03-20T07:15:00.000Z',
      tripPrice: 120000,
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
  [
    'route-002',
    {
      id: 'route-002',
      driverId: 'driver-002',
      carId: 'car-002',
      origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      serviceDate: '2030-03-20',
      departureTime: '2030-03-20T07:30:00.000Z',
      windowStart: '2030-03-20T07:15:00.000Z',
      windowEnd: '2030-03-20T07:45:00.000Z',
      tripPrice: 100000,
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
])

// ─── Trip Plans (replaces demands) ─────────────────────────────────────────────
// Grouped trip plans with matching ward pairs form demand groups.

const tripPlans = new Map([
  [
    'tripPlan-001',
    {
      id: 'tripPlan-001',
      clientId: 'client-001',
      pickup: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      dropoff: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      pickupWardId: 'ward-q1-bennghe',
      dropoffWardId: 'ward-td-binhtho',
      serviceDate: '2030-03-20',
      departureBlockStart: '2030-03-20T07:00:00.000Z',
      departureBlockEnd: '2030-03-20T07:30:00.000Z',
      passengerCount: 1,
      publishMode: 'grouped',
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
  [
    'tripPlan-002',
    {
      id: 'tripPlan-002',
      clientId: 'client-002',
      pickup: { lat: 10.778, lng: 106.702, label: 'Quận 1' },
      dropoff: { lat: 10.855, lng: 106.754, label: 'Thủ Đức' },
      pickupWardId: 'ward-q1-bennghe',
      dropoffWardId: 'ward-td-binhtho',
      serviceDate: '2030-03-20',
      departureBlockStart: '2030-03-20T07:00:00.000Z',
      departureBlockEnd: '2030-03-20T07:30:00.000Z',
      passengerCount: 2,
      publishMode: 'grouped',
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T01:00:00.000Z',
    },
  ],
  [
    'tripPlan-003',
    {
      id: 'tripPlan-003',
      clientId: 'client-001',
      pickup: { lat: 10.8, lng: 106.65, label: 'Tân Bình' },
      dropoff: { lat: 10.85, lng: 106.76, label: 'Thủ Đức' },
      pickupWardId: 'ward-tb-p15',
      dropoffWardId: 'ward-td-binhtho',
      serviceDate: '2030-03-20',
      departureBlockStart: '2030-03-20T07:00:00.000Z',
      departureBlockEnd: '2030-03-20T07:30:00.000Z',
      passengerCount: 1,
      publishMode: 'grouped',
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T02:00:00.000Z',
    },
  ],
  [
    'tripPlan-004',
    {
      id: 'tripPlan-004',
      clientId: 'client-002',
      pickup: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      dropoff: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      pickupWardId: 'ward-q1-bennghe',
      dropoffWardId: 'ward-td-binhtho',
      serviceDate: '2030-03-21',
      departureBlockStart: '2030-03-21T07:00:00.000Z',
      departureBlockEnd: '2030-03-21T07:30:00.000Z',
      passengerCount: 1,
      publishMode: 'search_only',
      notes: 'Tìm tài xế trực tiếp',
      status: 'published',
      createdAt: '2026-01-05T03:00:00.000Z',
    },
  ],
])

// ─── Request Entities (replace matches + offers) ───────────────────────────────

const groupRequests = new Map()
const groupOffers = new Map()
const searchRequests = new Map()

// ─── Deprecated but kept inert ─────────────────────────────────────────────────

const templates = new Map()
const savedLocations = new Map([
  [
    'savedloc-001',
    { id: 'savedloc-001', label: 'Nhà', lat: 10.7769, lng: 106.7009 },
  ],
  [
    'savedloc-002',
    { id: 'savedloc-002', label: 'Công ty', lat: 10.8544, lng: 106.7539 },
  ],
])

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — User
// ═══════════════════════════════════════════════════════════════════════════════

function getUser(userId) {
  return users.get(userId) || null
}

function setUserMode(userId, mode) {
  const user = users.get(userId)
  if (!user) return null
  user.preferredMode = mode
  user.modeSelectedAt = new Date().toISOString()
  users.set(userId, user)
  return { preferredMode: user.preferredMode, modeSelectedAt: user.modeSelectedAt }
}

function getUserMode(userId) {
  const user = users.get(userId)
  if (!user) return null
  return { preferredMode: user.preferredMode || null, modeSelectedAt: user.modeSelectedAt || null }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Car (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

function createCar(ownerId, data) {
  const car = {
    id: nextId('car'),
    ownerId,
    createdAt: new Date().toISOString(),
    ...data,
  }
  cars.set(car.id, car)
  return car
}

function listCarsByOwner(ownerId) {
  return [...cars.values()].filter((car) => car.ownerId === ownerId)
}

function updateCar(id, data) {
  const existing = cars.get(id)
  if (!existing) return null
  const updated = { ...existing, ...data }
  cars.set(id, updated)
  return updated
}

function deleteCar(id) {
  return cars.delete(id)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Route (Phase 2: tripPrice, serviceDate)
// ═══════════════════════════════════════════════════════════════════════════════

function createRoute(driverId, data) {
  const route = {
    id: nextId('route'),
    driverId,
    status: 'draft',
    notes: '',
    createdAt: new Date().toISOString(),
    ...data,
  }
  routes.set(route.id, route)
  return route
}

function listRoutesByDriver(driverId) {
  return [...routes.values()].filter((route) => route.driverId === driverId)
}

function getRoute(id) {
  return routes.get(id) || null
}

function updateRoute(id, data) {
  const existing = routes.get(id)
  if (!existing) return null
  const updated = { ...existing, ...data }
  routes.set(id, updated)
  return updated
}

function listAllRoutes() {
  return [...routes.values()]
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Trip Plan (replaces demand CRUD)
// ═══════════════════════════════════════════════════════════════════════════════

function createTripPlan(clientId, data) {
  const tripPlan = {
    id: nextId('tripPlan'),
    clientId,
    status: 'published',
    notes: '',
    createdAt: new Date().toISOString(),
    ...data,
  }
  tripPlans.set(tripPlan.id, tripPlan)
  return tripPlan
}

function getTripPlan(id) {
  return tripPlans.get(id) || null
}

function updateTripPlan(id, data) {
  const existing = tripPlans.get(id)
  if (!existing) return null
  const updated = { ...existing, ...data }
  tripPlans.set(id, updated)
  return updated
}

function listTripPlansByClient(clientId) {
  return [...tripPlans.values()].filter((tp) => tp.clientId === clientId)
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
  return `${tp.serviceDate}|${tp.pickupWardId}|${tp.dropoffWardId}|${tp.departureBlockStart}`
}

function deriveDemandGroups() {
  const grouped = new Map()

  for (const tp of tripPlans.values()) {
    if (tp.publishMode !== 'grouped') continue
    if (tp.status !== 'published') continue

    const key = buildGroupKey(tp)
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `dg-${key}`,
        serviceDate: tp.serviceDate,
        pickupWardId: tp.pickupWardId,
        dropoffWardId: tp.dropoffWardId,
        departureBlockStart: tp.departureBlockStart,
        departureBlockEnd: tp.departureBlockEnd,
        memberCount: 0,
        totalPassengerCount: 0,
        memberTripPlanIds: [],
      })
    }
    const group = grouped.get(key)
    group.memberCount += 1
    group.totalPassengerCount += tp.passengerCount
    group.memberTripPlanIds.push(tp.id)
  }

  return [...grouped.values()]
}

function getDemandGroup(groupId) {
  return deriveDemandGroups().find((g) => g.id === groupId) || null
}

function getDemandGroupMembers(groupId) {
  const group = getDemandGroup(groupId)
  if (!group) return null
  return group.memberTripPlanIds.map((id) => tripPlans.get(id)).filter(Boolean)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Route Availability
// ═══════════════════════════════════════════════════════════════════════════════

function isRouteAvailable(routeId) {
  for (const offer of groupOffers.values()) {
    if (offer.routeId === routeId && offer.status === 'accepted') return false
  }
  for (const req of searchRequests.values()) {
    if (req.routeId === routeId && req.status === 'accepted') return false
  }
  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Group Request Orchestration
// ═══════════════════════════════════════════════════════════════════════════════

function createGroupRequest(driverId, routeId, demandGroupId, note) {
  if (!isRouteAvailable(routeId)) {
    throw new Error('Route is not available — already has an accepted client')
  }

  const route = getRoute(routeId)
  if (!route) throw new Error('Route not found')

  const group = getDemandGroup(demandGroupId)
  if (!group) throw new Error('Demand group not found')

  const greq = {
    id: nextId('greq'),
    driverId,
    routeId,
    demandGroupId,
    note: note || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  groupRequests.set(greq.id, greq)

  // Fan out one group offer per eligible member
  const createdOffers = []
  for (const tpId of group.memberTripPlanIds) {
    const tp = tripPlans.get(tpId)
    if (!tp) continue
    const offer = {
      id: nextId('goffer'),
      groupRequestId: greq.id,
      routeId,
      driverId,
      clientId: tp.clientId,
      tripPlanId: tpId,
      tripPrice: route.tripPrice,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    groupOffers.set(offer.id, offer)
    createdOffers.push(offer)

    emitNotification('group_offer_received', tp.clientId, {
      groupOfferId: offer.id,
      groupRequestId: greq.id,
      driverId,
      routeId,
    })
  }

  return { groupRequest: greq, offers: createdOffers }
}

function acceptGroupOffer(offerId) {
  const offer = groupOffers.get(offerId)
  if (!offer) throw new Error('Group offer not found')
  if (offer.status !== 'pending') {
    throw new Error(`Cannot accept offer in status: ${offer.status}`)
  }
  if (!isRouteAvailable(offer.routeId)) {
    throw new Error('Route is no longer available — another client was accepted first')
  }

  // Mark this offer accepted
  offer.status = 'accepted'
  groupOffers.set(offerId, offer)

  // Close all sibling offers from the same group request
  for (const sibling of groupOffers.values()) {
    if (
      sibling.groupRequestId === offer.groupRequestId &&
      sibling.id !== offerId &&
      sibling.status === 'pending'
    ) {
      sibling.status = 'closed'
      groupOffers.set(sibling.id, sibling)

      emitNotification('sibling_offer_closed', sibling.clientId, {
        groupOfferId: sibling.id,
        reason: 'another_client_accepted',
      })
    }
  }

  // Close conflicting pending search requests for this route
  for (const req of searchRequests.values()) {
    if (req.routeId === offer.routeId && req.status === 'pending') {
      req.status = 'closed'
      searchRequests.set(req.id, req)
    }
  }

  emitNotification('group_offer_accepted', offer.driverId, {
    groupOfferId: offerId,
    clientId: offer.clientId,
    routeId: offer.routeId,
  })

  return offer
}

function declineGroupOffer(offerId) {
  const offer = groupOffers.get(offerId)
  if (!offer) throw new Error('Group offer not found')
  if (offer.status !== 'pending') {
    throw new Error(`Cannot decline offer in status: ${offer.status}`)
  }
  offer.status = 'declined'
  groupOffers.set(offerId, offer)

  emitNotification('group_offer_declined', offer.driverId, {
    groupOfferId: offerId,
    clientId: offer.clientId,
  })

  return offer
}

function cancelGroupRequest(requestId) {
  const greq = groupRequests.get(requestId)
  if (!greq) throw new Error('Group request not found')
  if (greq.status !== 'pending') {
    throw new Error(`Cannot cancel request in status: ${greq.status}`)
  }

  greq.status = 'canceled'
  groupRequests.set(requestId, greq)

  // Close all still-pending sibling offers
  for (const offer of groupOffers.values()) {
    if (offer.groupRequestId === requestId && offer.status === 'pending') {
      offer.status = 'closed'
      groupOffers.set(offer.id, offer)

      emitNotification('sibling_offer_closed', offer.clientId, {
        groupOfferId: offer.id,
        reason: 'group_request_canceled',
      })
    }
  }

  emitNotification('group_request_canceled', greq.driverId, {
    groupRequestId: requestId,
  })

  return greq
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Search Request Orchestration
// ═══════════════════════════════════════════════════════════════════════════════

function createSearchRequest(clientId, tripPlanId, routeId, note) {
  const tp = getTripPlan(tripPlanId)
  if (!tp) throw new Error('Trip plan not found')
  if (tp.publishMode !== 'search_only') {
    throw new Error('Only search_only trip plans can create search requests')
  }
  if (!isRouteAvailable(routeId)) {
    throw new Error('Route is not available — already has an accepted client')
  }
  const route = getRoute(routeId)
  if (!route) throw new Error('Route not found')

  const sreq = {
    id: nextId('sreq'),
    clientId,
    tripPlanId,
    routeId,
    driverId: route.driverId,
    tripPrice: route.tripPrice,
    note: note || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  searchRequests.set(sreq.id, sreq)

  emitNotification('search_request_received', route.driverId, {
    searchRequestId: sreq.id,
    clientId,
    routeId,
  })

  return sreq
}

function acceptSearchRequest(requestId) {
  const sreq = searchRequests.get(requestId)
  if (!sreq) throw new Error('Search request not found')
  if (sreq.status !== 'pending') {
    throw new Error(`Cannot accept search request in status: ${sreq.status}`)
  }
  if (!isRouteAvailable(sreq.routeId)) {
    throw new Error('Route is no longer available — another client was accepted first')
  }

  sreq.status = 'accepted'
  searchRequests.set(requestId, sreq)

  // Close conflicting pending group offers for this route
  for (const offer of groupOffers.values()) {
    if (offer.routeId === sreq.routeId && offer.status === 'pending') {
      offer.status = 'closed'
      groupOffers.set(offer.id, offer)
    }
  }

  // Close conflicting pending search requests for this route (except the winner)
  for (const req of searchRequests.values()) {
    if (req.routeId === sreq.routeId && req.id !== requestId && req.status === 'pending') {
      req.status = 'closed'
      searchRequests.set(req.id, req)
    }
  }

  emitNotification('search_request_accepted', sreq.clientId, {
    searchRequestId: requestId,
    routeId: sreq.routeId,
    driverId: sreq.driverId,
  })

  return sreq
}

function declineSearchRequest(requestId) {
  const sreq = searchRequests.get(requestId)
  if (!sreq) throw new Error('Search request not found')
  if (sreq.status !== 'pending') {
    throw new Error(`Cannot decline search request in status: ${sreq.status}`)
  }
  sreq.status = 'declined'
  searchRequests.set(requestId, sreq)

  emitNotification('search_request_declined', sreq.clientId, {
    searchRequestId: requestId,
  })

  return sreq
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — List helpers for request entities
// ═══════════════════════════════════════════════════════════════════════════════

function listGroupRequestsByDriver(driverId) {
  return [...groupRequests.values()].filter((r) => r.driverId === driverId)
}

function listGroupOffersByClient(clientId) {
  return [...groupOffers.values()].filter((o) => o.clientId === clientId)
}

function listSearchRequestsByDriver(driverId) {
  return [...searchRequests.values()].filter((r) => r.driverId === driverId)
}

function listSearchRequestsByClient(clientId) {
  return [...searchRequests.values()].filter((r) => r.clientId === clientId)
}

function listSearchRequestsByRoute(routeId) {
  return [...searchRequests.values()].filter((r) => r.routeId === routeId)
}

function listGroupOffersByRoute(routeId) {
  return [...groupOffers.values()].filter((o) => o.routeId === routeId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS — Deprecated template / saved-location (kept inert)
// ═══════════════════════════════════════════════════════════════════════════════

function createSavedLocation(payload) {
  if (savedLocations.size >= 10) {
    throw new Error('Maximum 10 saved locations allowed')
  }
  const location = { id: nextId('savedloc'), ...payload }
  savedLocations.set(location.id, location)
  return location
}

function listSavedLocations() {
  return [...savedLocations.values()]
}

function deleteSavedLocation(id) {
  return savedLocations.delete(id)
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // ID
  nextId,

  // User
  getUser,
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
