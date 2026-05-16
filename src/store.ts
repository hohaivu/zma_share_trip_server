import { query, withTransaction } from './db/connection'
import { groupRequestService as mvcGroupRequestService } from './services/groupRequestService'
import * as notificationService from './services/notificationService'
import * as reportService from './services/reportService'
import * as reviewService from './services/reviewService'
import { routeRequestService as routeRequestDomainService } from './services/routeRequestService'
import { computeDepartureBlock as computeDepartureBlockDomain } from './domain/departureBlock'
import * as userRepository from './repositories/userRepository'
import * as userService from './services/userService'
import {
  mapRows,
  normalizeUtc,
  parseJsonb,
  parseNumeric,
  toCamelCase,
} from './db/utils'
import { HttpError } from './http-error'
import {
  chargeRouteFee as chargeRouteFeeRepo,
  chargeRouteFeeTx,
  computeAvailableBalanceVnd,
  computeRouteFeeRequiredVnd,
  getDriverWalletSummary as getDriverWalletSummaryRepo,
  getOrCreateDriverWallet as getOrCreateDriverWalletRepo,
  getOrCreateDriverWalletTx,
  insertWalletTransactionTx,
  listDriverWalletTransactions as listDriverWalletTransactionsRepo,
  loadRouteForWalletTx,
  mapWallet,
  mapWalletTransaction,
  refundRouteFee as refundRouteFeeRepo,
  refundRouteFeeTx,
  releaseRouteFee as releaseRouteFeeRepo,
  releaseRouteFeeTx,
  reserveRouteFee as reserveRouteFeeRepo,
  reserveRouteFeeTx,
  topUpDriverWallet as topUpDriverWalletRepo,
  updateWalletRowTx,
  type DbQueryExecutor,
} from './repositories/walletRepository'
import { mapCar } from './repositories/carRepository'
import * as driverRouteRepository from './repositories/driverRouteRepository'
import * as planRepository from './repositories/planRepository'
import * as journeyRepository from './repositories/journeyRepository'
import { type TripListScope } from './repositories/tripListRepository'
import {
  createCar as createCarService,
  deleteCar as deleteCarService,
  getCarById as getCarByIdService,
  listCarsByOwner as listCarsByOwnerService,
  updateCar as updateCarService,
} from './services/carService'
import {
  AppNotification,
  GroupOffer,
  BootstrapSession,
  Identity,
  GroupRequest,
  Location,
  Plan,
  Report,
  Review,
  Route,
  SavedLocation,
  RouteRequest,
  User,
  Wallet,
  WalletTransaction,
} from './types/entities'
import {
  BootstrapResult,
  CreateCarPayload,
  CreateNotificationPayload,
  CreatePlanPayload,
  CreateReportPayload,
  CreateReviewPayload,
  CreateRoutePayload,
  DemandGroupSummary,
  ManualTopUpPayload,
  ReviewEligibility,
  ManualTopUpResult,
  UpdateCarPayload,
  UpdatePlanPayload,
  UpdateRoutePayload,
  UpdateUserPayload,
  WalletSummary,
  WithReviewEligibility,
} from './types/payloads'

// --- Helpers ---

function formatLocalDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isTerminalTripStatus(status?: string | null): boolean {
  return status === 'completed' || status === 'canceled'
}

function isActiveTripStatus(status?: string | null): boolean {
  return status === 'draft' || status === 'published' || status === 'matched'
}

function isPastServiceDate(serviceDate?: string | null): boolean {
  if (!serviceDate) return false
  return serviceDate < formatLocalDateValue(new Date())
}

function assertServiceDateIsNotPast(serviceDate?: string | null): void {
  if (isPastServiceDate(serviceDate)) {
    throw new HttpError(400, 'serviceDate cannot be in the past')
  }
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

export function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function mapUser(row: Record<string, unknown>): User {
  const user = toCamelCase<User>(row)
  if (!user) throw new Error('Cannot map null row to User')
  user.ratingAvg = parseNumeric(user.ratingAvg)
  user.tripCount = Number(user.tripCount || 0)
  user.blockedUserIds = parseJsonb<string[]>(row.blocked_user_ids) || []
  user.preferredMode = user.preferredMode || user.role || 'client'
  user.activeMode = user.preferredMode
  return user
}

function mapIdentity(row: Record<string, unknown>): Identity {
  const identity = toCamelCase<Identity>(row)
  if (!identity) throw new Error('Cannot map null row to Identity')
  identity.preferredMode = identity.preferredMode || 'client'
  return identity
}

function mapRoute(row: Record<string, unknown>): Route {
  const route = toCamelCase<Route>(row)
  if (!route) throw new Error('Cannot map null row to Route')
  route.tripPrice = parseNumeric(route.tripPrice)
  route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd)
  return route
}

function buildSession(
  identity: Identity,
  personas: User[],
  wasCreated: boolean,
): BootstrapSession {
  const driver = personas.find((persona) => persona.role === 'driver')
  const client = personas.find((persona) => persona.role === 'client')
  if (!driver || !client) throw new Error('Identity missing required personas')
  const activeMode = identity.preferredMode === 'driver' ? 'driver' : 'client'
  const activeUser = activeMode === 'driver' ? driver : client
  return {
    identity,
    personas: { driver, client },
    activeMode,
    activeUser: { ...activeUser, activeMode },
    wasCreated,
  }
}

export function listByColumn<T>(
  table: string,
  column: string,
  mapFn: (row: Record<string, unknown>) => T | null = toCamelCase,
) {
  return async (value: string | number): Promise<T[]> => {
    const result = await query(`SELECT * FROM ${table} WHERE ${column} = $1`, [
      value,
    ])
    return result.rows.map(mapFn).filter(Boolean) as T[]
  }
}

export { mapCar } from './repositories/carRepository'

// --- Wallet ---

export {
  computeAvailableBalanceVnd,
  getOrCreateDriverWalletTx,
  insertWalletTransactionTx,
  mapWallet,
  mapWalletTransaction,
  refundRouteFeeTx,
  releaseRouteFeeTx,
  reserveRouteFeeTx,
  updateWalletRowTx,
  type DbQueryExecutor,
} from './repositories/walletRepository'

export async function getOrCreateDriverWallet(
  driverId: string,
): Promise<Wallet> {
  await assertUserRole(driverId, 'driver')
  return getOrCreateDriverWalletRepo(driverId)
}

export async function getDriverWalletSummary(
  driverId: string,
): Promise<WalletSummary> {
  await assertUserRole(driverId, 'driver')
  return getDriverWalletSummaryRepo(driverId)
}

export async function listDriverWalletTransactions(
  driverId: string,
  limit?: number,
): Promise<WalletTransaction[]> {
  await assertUserRole(driverId, 'driver')
  return listDriverWalletTransactionsRepo(driverId, limit)
}

export async function topUpDriverWallet(
  driverId: string,
  payload: ManualTopUpPayload,
): Promise<ManualTopUpResult> {
  await assertUserRole(driverId, 'driver')
  return topUpDriverWalletRepo(driverId, payload)
}

export async function reserveRouteFee(
  routeId: string,
  driverId: string,
  feeRequiredVnd: number,
  meta?: { description?: string },
): Promise<Route> {
  return reserveRouteFeeRepo(routeId, driverId, feeRequiredVnd, mapRoute, meta)
}

export async function releaseRouteFee(
  routeId: string,
  driverId: string,
  meta?: { description?: string },
): Promise<Route> {
  return releaseRouteFeeRepo(routeId, driverId, mapRoute, meta)
}

export async function chargeRouteFee(
  routeId: string,
  driverId: string,
  meta?: { description?: string },
): Promise<Route> {
  return chargeRouteFeeRepo(routeId, driverId, mapRoute, meta)
}

export async function refundRouteFee(
  routeId: string,
  driverId: string,
  meta?: { description?: string },
): Promise<Route> {
  return refundRouteFeeRepo(routeId, driverId, mapRoute, meta)
}

/**
 * Generic dynamic-update for any table. Builds a parameterized UPDATE from
 * a camelCase data object, stringifying any keys listed in jsonFields.
 */
export async function dynamicUpdate<T>(
  table: string,
  id: string,
  data: Record<string, unknown>,
  jsonFields: string[] = [],
): Promise<T | null> {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined)
  if (keys.length === 0) {
    const existing = await query(`SELECT * FROM ${table} WHERE id = $1`, [id])
    return toCamelCase<T>(existing.rows[0])
  }

  const setClauses = keys.map((key, idx) => `${toSnakeCase(key)} = $${idx + 2}`)
  const timeFields = [
    'departureTime',
    'windowStart',
    'windowEnd',
    'departureBlockStart',
    'departureBlockEnd',
  ]
  const vals = keys.map((k) => {
    const val = data[k]
    if (jsonFields.includes(k)) return JSON.stringify(val)
    if (timeFields.includes(k) && val)
      return new Date(val as string | number | Date).toISOString()
    return val
  })

  const result = await query(
    `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...vals],
  )
  return toCamelCase<T>(result.rows[0])
}

// --- Notifications ---

export function emitNotification(
  type: string,
  recipientId: string,
  data: Record<string, unknown>,
): void {
  notificationService.emitNotification(type, recipientId, data)
}

export async function listNotifications(
  recipientId: string,
): Promise<AppNotification[]> {
  return notificationService.listNotifications(recipientId)
}

// --- User ---

export async function getUser(userId: string): Promise<User | null> {
  return userService.getUser(userId)
}

async function getIdentity(identityId: string): Promise<Identity | null> {
  const result = await query('SELECT * FROM identities WHERE id = $1', [
    identityId,
  ])
  return result.rows[0] ? mapIdentity(result.rows[0]) : null
}

const PERSONA_SELECT_SQL = `
  SELECT u.*, i.mauid, i.display_name, i.avatar_url, i.phone,
         i.preferred_mode, i.mode_selected_at
  FROM users u
  JOIN identities i ON i.id = u.identity_id
  WHERE u.identity_id = $1
`

async function listPersonasByIdentity(
  identityId: string,
  executor: DbQueryExecutor = { query },
): Promise<User[]> {
  const result = await executor.query(
    `${PERSONA_SELECT_SQL} ORDER BY u.role`,
    [identityId],
  )
  return result.rows.map(mapUser)
}

export async function assertUserRole(userId: string, role: 'driver' | 'client'): Promise<void> {
  const user = await getUser(userId)
  if (!user) throw new HttpError(404, 'User not found')
  if (user.role !== role) {
    throw new HttpError(403, `User must be a ${role} persona`)
  }
}

export async function getSessionByIdentity(
  identityId: string,
): Promise<BootstrapSession | null> {
  const identity = await getIdentity(identityId)
  if (!identity) return null
  return buildSession(identity, await listPersonasByIdentity(identity.id), false)
}

export async function updateUser(
  userId: string,
  data: UpdateUserPayload,
): Promise<User | null> {
  return userService.updateUser(userId, data)
}

export async function setUserMode(
  identityId: string,
  mode: string,
): Promise<BootstrapSession | null> {
  return userService.setUserMode(identityId, mode)
}

export async function getUserMode(
  identityId: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  return userService.getUserMode(identityId)
}

export async function bootstrapUser(
  mauid: string,
  displayName?: string,
  avatarUrl?: string,
): Promise<BootstrapResult> {
  return userService.bootstrapUser(mauid, displayName, avatarUrl)
}

export async function createReview(
  payload: CreateReviewPayload,
): Promise<Review> {
  return reviewService.createReview(payload)
}

export async function listReviewsByReviewer(userId: string): Promise<Review[]> {
  return reviewService.listReviewsByReviewer(userId)
}

export async function createReport(
  payload: CreateReportPayload,
): Promise<Report> {
  return reportService.createReport(payload)
}

export async function listReportsByReporter(userId: string): Promise<Report[]> {
  return reportService.listReportsByReporter(userId)
}

export async function getBlockedUsers(blockerId: string): Promise<string[]> {
  return userRepository.getBlockedUsers(blockerId)
}

export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<string[]> {
  return userRepository.blockUser(blockerId, blockedId)
}

export async function unblockUser(
  blockerId: string,
  blockedId: string,
): Promise<string[]> {
  return userRepository.unblockUser(blockerId, blockedId)
}

export async function createNotification(
  payload: CreateNotificationPayload,
): Promise<AppNotification> {
  return notificationService.createNotification(payload)
}

export async function markNotificationRead(
  recipientId: string,
  notificationId: string,
): Promise<AppNotification | null> {
  return notificationService.markNotificationRead(recipientId, notificationId)
}

export async function markAllNotificationsRead(
  recipientId: string,
): Promise<void> {
  return notificationService.markAllNotificationsRead(recipientId)
}

// --- Car ---

export async function createCar(
  ownerId: string,
  data: CreateCarPayload,
): ReturnType<typeof createCarService> {
  return createCarService(ownerId, data)
}

export async function listCarsByOwner(
  ownerId: string,
): ReturnType<typeof listCarsByOwnerService> {
  return listCarsByOwnerService(ownerId)
}

export async function getCarById(
  id: string,
): ReturnType<typeof getCarByIdService> {
  return getCarByIdService(id)
}

export async function updateCar(
  id: string,
  data: UpdateCarPayload,
): ReturnType<typeof updateCarService> {
  return updateCarService(id, data)
}

export async function deleteCar(id: string): Promise<boolean> {
  return deleteCarService(id)
}

// --- Route ---

function extractWardFields(
  data: Record<string, unknown>,
  prefix: string,
  geoObj?: Location,
) {
  const wardId = (data[`${prefix}WardId`] as string) || geoObj?.wardId || ''
  const provinceId =
    (data[`${prefix}ProvinceId`] as string) || geoObj?.provinceId || ''
  const wardKey =
    (data[`${prefix}WardKey`] as string) ||
    (wardId && provinceId ? `${wardId}_${provinceId}` : '')
  return { wardId, provinceId, wardKey }
}

const IMMUTABLE_PUBLISHED_ROUTE_FIELDS: Array<keyof UpdateRoutePayload> = [
  'origin',
  'destination',
  'originWardKey',
  'originWardId',
  'originProvinceId',
  'destinationWardKey',
  'destinationWardId',
  'destinationProvinceId',
  'serviceDate',
  'departureTime',
  'windowStart',
  'windowEnd',
  'distanceMeters',
]

function hasImmutablePublishedRouteFieldUpdate(
  data: UpdateRoutePayload,
): boolean {
  return IMMUTABLE_PUBLISHED_ROUTE_FIELDS.some(
    (field) => data[field] !== undefined,
  )
}

function buildRouteWriteValues(
  route: Route,
  data: UpdateRoutePayload,
): {
  carId: string
  origin: Location
  destination: Location
  originWardKey: string
  originWardId: string
  originProvinceId: string
  destinationWardKey: string
  destinationWardId: string
  destinationProvinceId: string
  serviceDate: string
  departureTime: string
  windowStart: string
  windowEnd: string
  tripPrice: number
  distanceMeters: number | null
  notes: string
} {
  const departureTime = data.departureTime
    ? (normalizeUtc(data.departureTime) as string)
    : route.departureTime
  const departureWindow = computeDepartureBlock(departureTime)

  return {
    carId: data.carId ?? route.carId,
    origin: data.origin ?? route.origin,
    destination: data.destination ?? route.destination,
    originWardKey: data.originWardKey ?? route.originWardKey,
    originWardId: data.originWardId ?? route.originWardId,
    originProvinceId: data.originProvinceId ?? route.originProvinceId,
    destinationWardKey: data.destinationWardKey ?? route.destinationWardKey,
    destinationWardId: data.destinationWardId ?? route.destinationWardId,
    destinationProvinceId:
      data.destinationProvinceId ?? route.destinationProvinceId,
    serviceDate: data.serviceDate ?? route.serviceDate,
    departureTime,
    windowStart: data.windowStart
      ? (normalizeUtc(data.windowStart) as string)
      : data.departureTime
        ? departureWindow.start
        : route.windowStart,
    windowEnd: data.windowEnd
      ? (normalizeUtc(data.windowEnd) as string)
      : data.departureTime
        ? departureWindow.end
        : route.windowEnd,
    tripPrice: data.tripPrice ?? route.tripPrice,
    distanceMeters: data.distanceMeters ?? route.distanceMeters ?? null,
    notes: data.notes ?? route.notes ?? '',
  }
}

export type { TripListScope } from './repositories/tripListRepository'

export async function createRoute(
  driverId: string,
  data: CreateRoutePayload,
): Promise<Route> {
  return driverRouteRepository.createRoute(driverId, data)
}

export async function getRoute(id: string): Promise<Route | null> {
  return journeyRepository.getRoute(id)
}

export async function updateRoute(
  id: string,
  data: UpdateRoutePayload,
): Promise<Route | null> {
  return driverRouteRepository.updateRoute(id, data)
}

export async function publishRoute(
  id: string,
  data: UpdateRoutePayload = {},
): Promise<Route> {
  return driverRouteRepository.publishRoute(id, data)
}

export async function listAllRoutes(): Promise<Route[]> {
  return driverRouteRepository.listAllRoutes()
}

// --- Plan ---

export async function createPlan(
  clientId: string,
  data: CreatePlanPayload,
): Promise<Plan> {
  return planRepository.createPlan(clientId, data)
}

export async function getPlan(id?: string): Promise<Plan | null> {
  return journeyRepository.getPlan(id)
}

export async function updatePlan(
  id: string,
  data: UpdatePlanPayload,
): Promise<Plan | null> {
  return planRepository.updatePlan(id, data)
}

export async function cancelPlanByClient(
  planId: string,
  clientId: string,
): Promise<Plan> {
  return planRepository.cancelPlanByClient(planId, clientId)
}

export async function listRoutesByDriver(
  driverId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Route>>> {
  return driverRouteRepository.listRoutesByDriver(driverId, scope)
}

export async function listPlansByClient(
  clientId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Plan>>> {
  return planRepository.listPlansByClient(clientId, scope)
}

export async function getReviewEligibility(
  tripId: string,
  viewerId: string,
  now: Date = new Date(),
): Promise<ReviewEligibility> {
  return journeyRepository.getReviewEligibility(tripId, viewerId, now)
}

async function shouldHideRequestForTerminalTrip(
  request:
    | Pick<RouteRequest, 'routeId' | 'planId'>
    | Pick<GroupOffer, 'routeId' | 'planId'>,
): Promise<boolean> {
  const route = await getRoute(request.routeId)
  if (isTerminalTripStatus(route?.status)) return true
  const plan = request.planId ? await getPlan(request.planId) : null
  return isTerminalTripStatus(plan?.status)
}

// --- Departure Block ---

export function computeDepartureBlock(departureTime: string | Date): {
  start: string
  end: string
} {
  return computeDepartureBlockDomain(departureTime)
}

// --- Demand Groups ---

function buildGroupKey(tp: Plan): string {
  // `toCamelCase` maps pg Dates to canonical ISO strings, but if
  // something bypassed it and sent +07:00, force it to canonical UTC
  const svcDate =
    typeof tp.serviceDate === 'string' && tp.serviceDate.includes('T')
      ? new Date(tp.serviceDate).toISOString().split('T')[0]
      : tp.serviceDate
  const dbs = normalizeUtc(tp.departureBlockStart)

  const pickupKey = tp.pickupWardKey || tp.pickupWardId
  const dropoffKey = tp.dropoffWardKey || tp.dropoffWardId
  return `${svcDate}|${pickupKey}|${dropoffKey}|${dbs}`
}

async function listEligiblePublishedPlans(
  executor: DbQueryExecutor = { query },
): Promise<Plan[]> {
  const result = await executor.query(
    `
      SELECT *
      FROM plans p
      WHERE p.status = $1
        AND NOT EXISTS (
          SELECT 1
          FROM route_requests sr
          WHERE sr.plan_id = p.id AND sr.status = 'accepted'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM group_offers go
          WHERE go.plan_id = p.id AND go.status = 'accepted'
        )
    `,
    ['published'],
  )

  return mapRows<Plan>(result.rows)
}

export async function deriveDemandGroups(): Promise<DemandGroupSummary[]> {
  const grouped = new Map<string, DemandGroupSummary>()

  const activePlans = await listEligiblePublishedPlans()

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
        memberPlanIds: [],
        pickup:
          typeof tp.pickup === 'string' ? JSON.parse(tp.pickup) : tp.pickup,
        dropoff:
          typeof tp.dropoff === 'string' ? JSON.parse(tp.dropoff) : tp.dropoff,
        clientIds: [],
      })
    }
    const group = grouped.get(key)
    if (!group) continue
    group.memberCount += 1
    group.totalPassengerCount += tp.passengerCount
    group.memberPlanIds.push(tp.id)
    group.clientIds.push(tp.clientId)
  }

  return [...grouped.values()]
}

export async function getDemandGroup(
  groupId: string,
): Promise<DemandGroupSummary | null> {
  const groups = await deriveDemandGroups()
  return groups.find((g) => g.id === groupId) || null
}

export async function getDemandGroupMembers(
  groupId: string,
): Promise<Plan[] | null> {
  const group = await getDemandGroup(groupId)
  if (!group) return null

  const result = await query(
    'SELECT * FROM plans WHERE id = ANY($1::varchar[])',
    [group.memberPlanIds],
  )
  return mapRows<Plan>(result.rows)
}

// --- Route Availability ---

export async function checkRouteAvailability(
  executor: {
    query: (
      sql: string,
      params: unknown[],
    ) => Promise<{ rowCount: number | null }>
  },
  routeId: string,
): Promise<boolean> {
  return driverRouteRepository.checkRouteAvailability(executor, routeId)
}

export async function isRouteAvailable(routeId: string): Promise<boolean> {
  return driverRouteRepository.isRouteAvailable(routeId)
}

// --- Group Request Orchestration ---

export async function createGroupRequest(
  driverId: string,
  routeId: string,
  demandGroupId: string,
  note?: string,
): Promise<{ groupRequest: GroupRequest; offers: GroupOffer[] }> {
  return mvcGroupRequestService.createGroupRequest(
    driverId,
    routeId,
    demandGroupId,
    note,
  )
}

export async function acceptGroupOffer(offerId: string): Promise<GroupOffer> {
  const result = await withTransaction(async (tx) => {
    let offerRes = await tx.query(
      'SELECT * FROM group_offers WHERE id = $1 FOR UPDATE',
      [offerId],
    )
    const offer = toCamelCase<GroupOffer>(offerRes.rows[0])
    if (!offer) throw new HttpError(404, 'Group offer not found')
    if (offer.status === 'accepted') {
      return { updatedOffer: offer, siblings: [], offer }
    }
    if (offer.status !== 'pending') {
      throw new HttpError(409, `Cannot accept offer in status: ${offer.status}`)
    }

    const route = await loadRouteForWalletTx(tx, offer.routeId, mapRoute)
    if (route.status !== 'published') {
      throw new HttpError(
        409,
        `Cannot accept offer on route in status: ${route.status}`,
      )
    }

    if (!(await checkRouteAvailability(tx, offer.routeId))) {
      throw new HttpError(
        409,
        'Route is no longer available — another client was accepted first',
      )
    }

    offerRes = await tx.query(
      "UPDATE group_offers SET status = 'accepted' WHERE id = $1 RETURNING *",
      [offerId],
    )
    const updatedOffer = toCamelCase<GroupOffer>(offerRes.rows[0])
    if (!updatedOffer) throw new Error('Failed to update group offer')

    await tx.query("UPDATE routes SET status = 'matched' WHERE id = $1", [
      offer.routeId,
    ])
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
      SET status = 'accepted',
          accepted_client_user_id = $1,
          accepted_plan_id = $2,
          client_id = $1
      WHERE id = $3
    `,
      [updatedOffer.clientId, updatedOffer.planId, updatedOffer.groupRequestId],
    )

    await tx.query(
      "UPDATE route_requests SET status = 'closed' WHERE route_id = $1 AND status = 'pending'",
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

export async function declineGroupOffer(offerId: string): Promise<GroupOffer> {
  const offerRes = await query('SELECT * FROM group_offers WHERE id = $1', [
    offerId,
  ])
  const offer = toCamelCase<GroupOffer>(offerRes.rows[0])
  if (!offer) throw new Error('Group offer not found')
  if (offer.status !== 'pending') {
    throw new Error(`Cannot decline offer in status: ${offer.status}`)
  }

  const updatedRes = await query(
    "UPDATE group_offers SET status = 'declined' WHERE id = $1 RETURNING *",
    [offerId],
  )
  const updated = toCamelCase<GroupOffer>(updatedRes.rows[0])
  if (!updated) throw new Error('Failed to update group offer')

  emitNotification('group_offer_declined', updated.driverId, {
    groupOfferId: offerId,
    clientId: updated.clientId,
  })

  return updated
}

export async function cancelGroupRequest(
  requestId: string,
): Promise<GroupRequest> {
  return mvcGroupRequestService.cancelGroupRequest(requestId)
}

export async function createRouteRequest(
  clientId: string,
  planId: string,
  routeId: string,
  note?: string,
): Promise<RouteRequest> {
  return routeRequestDomainService.createRouteRequest(clientId, planId, routeId, note)
}

export async function acceptRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  return routeRequestDomainService.acceptRouteRequest(requestId)
}

export async function cancelTrip(tripId: string): Promise<Route | Plan> {
  return journeyRepository.cancelTrip(tripId)
}

export async function completeTrip(tripId: string): Promise<Route | Plan> {
  return journeyRepository.completeTrip(tripId)
}

export async function declineRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  return routeRequestDomainService.declineRouteRequest(requestId)
}

export async function cancelRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  return routeRequestDomainService.cancelRouteRequest(requestId)
}

export async function listGroupRequestsByDriver(
  driverId: string,
): Promise<GroupRequest[]> {
  return mvcGroupRequestService.listGroupRequestsByDriver(driverId)
}

async function filterVisibleForActiveTrip<
  T extends Pick<RouteRequest, 'routeId' | 'planId'>,
>(items: T[]): Promise<T[]> {
  const visibility = await Promise.all(
    items.map((item) => shouldHideRequestForTerminalTrip(item)),
  )
  return items.filter((_, index) => !visibility[index])
}

export async function listGroupOffersByClient(
  clientId: string,
): Promise<GroupOffer[]> {
  await assertUserRole(clientId, 'client')
  const offersRes = await query(
    'SELECT * FROM group_offers WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
    [clientId],
  )
  return filterVisibleForActiveTrip(mapRows<GroupOffer>(offersRes.rows))
}

export async function listRouteRequestsByDriver(
  driverId: string,
): Promise<RouteRequest[]> {
  return routeRequestDomainService.listRouteRequestsByDriver(driverId)
}

export async function listRouteRequestsByClient(
  clientId: string,
): Promise<RouteRequest[]> {
  return routeRequestDomainService.listRouteRequestsByClient(clientId)
}

export async function listRouteRequestsByPlan(
  planId: string,
): Promise<RouteRequest[]> {
  return journeyRepository.listRouteRequestsByPlan(planId)
}

export async function listGroupOffersByPlan(
  planId: string,
): Promise<GroupOffer[]> {
  return journeyRepository.listGroupOffersByPlan(planId)
}

export const listRouteRequestsByRoute = journeyRepository.listRouteRequestsByRoute
export const listGroupOffersByRoute = journeyRepository.listGroupOffersByRoute

// --- Deprecated: saved locations ---

export async function createSavedLocation(payload: {
  label: string
  lat: number
  lng: number
}): Promise<SavedLocation> {
  return journeyRepository.createSavedLocation(payload)
}

export async function listSavedLocations(): Promise<SavedLocation[]> {
  return journeyRepository.listSavedLocations()
}

export async function deleteSavedLocation(id: string): Promise<boolean> {
  return journeyRepository.deleteSavedLocation(id)
}
