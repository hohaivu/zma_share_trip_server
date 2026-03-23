const VALID_TRIP_TRANSITIONS = {
  draft: ['published'],
  published: ['matched', 'expired'],
  matched: ['in_chat'],
  in_chat: ['confirmed'],
  confirmed: ['completed'],
  completed: [],
  canceled: [],
  expired: [],
}

const STATUS_GROUP_MAP = {
  active: ['in_chat', 'confirmed'],
  upcoming: ['published', 'matched'],
  completed: ['completed'],
  cancelled: ['canceled', 'expired'],
}

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
      blockedUserIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
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
      blockedUserIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
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
      shareableSeats: 3,
      verificationStatus: 'verified',
      photos: [],
      createdAt: '2026-01-03T00:00:00.000Z',
    },
  ],
])

const routes = new Map([
  [
    'route-001',
    {
      id: 'route-001',
      driverId: 'driver-001',
      carId: 'car-001',
      origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      departureTime: '2030-03-20T00:00:00.000Z',
      windowStart: '2030-03-19T23:45:00.000Z',
      windowEnd: '2030-03-20T00:15:00.000Z',
      availableSeats: 3,
      pricePerSeat: 45000,
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
  [
    'route-006',
    {
      id: 'route-006',
      driverId: 'driver-001',
      carId: 'car-001',
      origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      departureTime: '2030-03-21T00:00:00.000Z',
      windowStart: '2030-03-20T23:45:00.000Z',
      windowEnd: '2030-03-21T00:15:00.000Z',
      availableSeats: 2,
      pricePerSeat: 50000,
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
])

const demands = new Map([
  [
    'demand-001',
    {
      id: 'demand-001',
      clientId: 'client-001',
      pickup: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      dropoff: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      desiredTime: '2030-03-20T00:00:00.000Z',
      windowStart: '2030-03-19T23:45:00.000Z',
      windowEnd: '2030-03-20T00:30:00.000Z',
      passengerCount: 1,
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
  [
    'demand-006',
    {
      id: 'demand-006',
      clientId: 'client-001',
      pickup: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      dropoff: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      desiredTime: '2030-03-21T00:00:00.000Z',
      windowStart: '2030-03-20T23:45:00.000Z',
      windowEnd: '2030-03-21T00:30:00.000Z',
      passengerCount: 1,
      notes: '',
      status: 'published',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
])

const matches = new Map([
  [
    'match-1',
    {
      id: 'match-1',
      driverRouteId: 'route-001',
      clientDemandId: 'demand-001',
      score: 92,
      pickupFit: 0.9,
      dropoffFit: 0.9,
      timeFit: 0.9,
      detourEstimate: 8,
      labels: ['cung_tuyen'],
    },
  ],
  [
    'match-6',
    {
      id: 'match-6',
      driverRouteId: 'route-006',
      clientDemandId: 'demand-006',
      score: 95,
      pickupFit: 0.9,
      dropoffFit: 0.9,
      timeFit: 0.9,
      detourEstimate: 6,
      labels: ['rat_phu_hop', 'cung_tuyen'],
    },
  ],
])

const offers = new Map([
  [
    'offer-1',
    {
      id: 'offer-1',
      matchId: 'match-6',
      driverId: 'driver-001',
      clientId: 'client-001',
      seatCount: 1,
      pricePerSeat: 50000,
      status: 'accepted',
      expiresAt: '2030-03-22T00:00:00.000Z',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
])

const templates = new Map([
  [
    'template-001',
    {
      id: 'template-001',
      origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
      destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
      time: '07:00',
      seats: 3,
      notes: '',
      recurrenceRule: { type: 'weekdays', time: '07:00' },
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
])

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

let idCounter = 1000

function nextId(prefix) {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

function isDriverRoute(trip) {
  return trip && Object.prototype.hasOwnProperty.call(trip, 'driverId')
}

function getUser(userId) {
  return users.get(userId)
}

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

  const updated = {
    ...existing,
    ...data,
  }
  cars.set(id, updated)
  return updated
}

function deleteCar(id) {
  return cars.delete(id)
}

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
  return routes.get(id)
}

function updateRoute(id, data) {
  const existing = routes.get(id)
  if (!existing) return null

  const updated = {
    ...existing,
    ...data,
  }
  routes.set(id, updated)
  return updated
}

function createDemand(clientId, data) {
  const demand = {
    id: nextId('demand'),
    clientId,
    status: 'draft',
    notes: '',
    createdAt: new Date().toISOString(),
    ...data,
  }
  demands.set(demand.id, demand)
  return demand
}

function listDemandsByClient(clientId) {
  return [...demands.values()].filter((demand) => demand.clientId === clientId)
}

function getDemand(id) {
  return demands.get(id)
}

function updateDemand(id, data) {
  const existing = demands.get(id)
  if (!existing) return null

  const updated = {
    ...existing,
    ...data,
  }
  demands.set(id, updated)
  return updated
}

function getTrip(tripId) {
  return routes.get(tripId) || demands.get(tripId) || null
}

function transitionTripStatus(tripId, status) {
  const trip = getTrip(tripId)
  if (!trip) return null

  if (trip.status === status) return trip

  const canCancel = status === 'canceled' && trip.status !== 'canceled'
  const allowed = VALID_TRIP_TRANSITIONS[trip.status] || []
  if (!canCancel && !allowed.includes(status)) {
    throw new Error(`Invalid state transition: ${trip.status} → ${status}`)
  }

  const updated = {
    ...trip,
    status,
  }
  if (isDriverRoute(trip)) {
    routes.set(trip.id, updated)
  } else {
    demands.set(trip.id, updated)
  }
  return updated
}

function listTripsByStatusGroup(userId, statusGroup) {
  const statuses = STATUS_GROUP_MAP[statusGroup]
  if (!statuses) {
    throw new Error(`Unknown status group: ${statusGroup}`)
  }

  const routeTrips = listRoutesByDriver(userId)
  const demandTrips = listDemandsByClient(userId)
  return [...routeTrips, ...demandTrips].filter((trip) =>
    statuses.includes(trip.status),
  )
}

function getTripDetail(tripId) {
  const trip = getTrip(tripId)
  if (!trip) return null

  const acceptedOffer = [...offers.values()].find((offer) => {
    if (offer.status !== 'accepted') return false
    const match = matches.get(offer.matchId)
    if (!match) return false

    return match.driverRouteId === tripId || match.clientDemandId === tripId
  })

  if (!acceptedOffer) return { ...trip }

  const matchedUserId = isDriverRoute(trip)
    ? acceptedOffer.clientId
    : acceptedOffer.driverId
  const matchedUser = users.get(matchedUserId)

  if (!matchedUser) return { ...trip }

  return {
    ...trip,
    matchedUser,
  }
}

function getMatch(id) {
  return matches.get(id)
}

function listMatchesForTrip(tripId) {
  return [...matches.values()].filter(
    (match) =>
      match.driverRouteId === tripId || match.clientDemandId === tripId,
  )
}

function listAllRoutes() {
  return [...routes.values()]
}

function listAllDemands() {
  return [...demands.values()]
}

function upsertMatch(matchCandidate) {
  const existing = [...matches.values()].find(
    (match) =>
      match.driverRouteId === matchCandidate.driverRouteId &&
      match.clientDemandId === matchCandidate.clientDemandId,
  )

  if (existing) {
    const updated = {
      ...existing,
      ...matchCandidate,
      id: existing.id,
    }
    matches.set(existing.id, updated)
    return updated
  }

  const created = {
    ...matchCandidate,
    id: nextId('match'),
  }
  matches.set(created.id, created)
  return created
}

function createOffer(payload) {
  const offer = {
    id: nextId('offer'),
    status: 'pending',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    ...payload,
  }
  offers.set(offer.id, offer)
  return offer
}

function getOffer(id) {
  return offers.get(id)
}

function updateOffer(id, data) {
  const existing = offers.get(id)
  if (!existing) return null

  const updated = {
    ...existing,
    ...data,
  }
  offers.set(id, updated)
  return updated
}

function listOffersByDriver(driverId) {
  return [...offers.values()].filter((offer) => offer.driverId === driverId)
}

function listOffersByClient(clientId) {
  return [...offers.values()].filter((offer) => offer.clientId === clientId)
}

function createTemplate(payload) {
  const template = {
    id: nextId('template'),
    createdAt: new Date().toISOString(),
    ...payload,
  }
  templates.set(template.id, template)
  return template
}

function listTemplates() {
  return [...templates.values()]
}

function getTemplate(id) {
  return templates.get(id)
}

function deleteTemplate(id) {
  return templates.delete(id)
}

function createRouteFromTemplate(templateId, driverId, carId) {
  const template = templates.get(templateId)
  if (!template) return null

  return createRoute(driverId, {
    carId,
    origin: template.origin,
    destination: template.destination,
    departureTime: template.time,
    windowStart: template.time,
    windowEnd: template.time,
    availableSeats: template.seats,
    notes: template.notes,
    recurrenceRule: template.recurrenceRule,
  })
}

function createSavedLocation(payload) {
  if (savedLocations.size >= 10) {
    throw new Error('Maximum 10 saved locations allowed')
  }

  const location = {
    id: nextId('savedloc'),
    ...payload,
  }
  savedLocations.set(location.id, location)
  return location
}

function listSavedLocations() {
  return [...savedLocations.values()]
}

function deleteSavedLocation(id) {
  return savedLocations.delete(id)
}

module.exports = {
  nextId,
  getUser,
  createCar,
  listCarsByOwner,
  updateCar,
  deleteCar,
  createRoute,
  listRoutesByDriver,
  getRoute,
  updateRoute,
  createDemand,
  listDemandsByClient,
  getDemand,
  updateDemand,
  getTrip,
  getTripDetail,
  transitionTripStatus,
  listTripsByStatusGroup,
  getMatch,
  listMatchesForTrip,
  listAllRoutes,
  listAllDemands,
  upsertMatch,
  createOffer,
  getOffer,
  updateOffer,
  listOffersByDriver,
  listOffersByClient,
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  createRouteFromTemplate,
  createSavedLocation,
  listSavedLocations,
  deleteSavedLocation,
}
