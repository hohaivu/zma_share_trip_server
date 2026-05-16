import { query, withTransaction } from './db/connection'
import { groupRequestService as mvcGroupRequestService } from './services/groupRequestService'
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
import {
  createCar as createCarService,
  deleteCar as deleteCarService,
  getCarById as getCarByIdService,
  listCarsByOwner as listCarsByOwnerService,
  updateCar as updateCarService,
} from './services/carService'
import {
  AppNotification,
  ClientRequestSource,
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

function isPgUniqueViolation(e: unknown, constraint: string): boolean {
  const err = e as Record<string, unknown>
  return err?.code === '23505' && err?.constraint === constraint
}

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

function mapAppNotification(row: Record<string, unknown>): AppNotification {
  const notification = toCamelCase<AppNotification>(row)
  if (!notification) throw new Error('Cannot map null row to AppNotification')
  notification.metadata =
    parseJsonb<Record<string, unknown>>(row.metadata) || {}
  return notification
}

const VALID_REPORT_REASONS = new Set([
  'no_show',
  'unsafe_behavior',
  'misleading_route',
  'harassment',
  'spam',
  'fake_profile',
])

function inferRequestSource(type: string): ClientRequestSource | undefined {
  if (type.startsWith('group_')) return 'group_offer'
  if (type.startsWith('route_')) return 'route_request'
  return undefined
}

function buildNotificationCopy(
  type: string,
  data: Record<string, unknown>,
): Omit<
  AppNotification,
  'id' | 'recipientId' | 'read' | 'readAt' | 'createdAt'
> {
  const requestSource = inferRequestSource(type)

  switch (type) {
    case 'group_offer_received':
    case 'route_request_received':
      return {
        type: 'request_received',
        title: 'New request received',
        body:
          type === 'group_offer_received'
            ? 'You received a new group offer.'
            : 'You received a new direct request.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource,
        metadata: data,
      }
    case 'group_offer_accepted':
    case 'route_request_accepted':
      return {
        type: 'request_accepted',
        title: 'Request accepted',
        body: 'Your request was accepted.',
        targetRoute: '/journeys',
        deepLink: '/journeys',
        requestSource,
        metadata: data,
      }
    case 'group_offer_declined':
    case 'route_request_declined':
      return {
        type: 'request_declined',
        title: 'Request declined',
        body: 'Your request was declined.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource,
        metadata: data,
      }
    case 'group_request_canceled':
    case 'route_request_canceled':
      return {
        type: 'request_canceled',
        title: 'Request canceled',
        body: 'A request was canceled.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource:
          type === 'group_request_canceled'
            ? 'group_request'
            : 'route_request',
        metadata: data,
      }
    case 'sibling_offer_closed':
      return {
        type: 'request_closed',
        title: 'Request closed',
        body: 'This request is no longer available.',
        targetRoute: '/offers',
        deepLink: '/offers',
        requestSource: 'group_offer',
        metadata: data,
      }
    default:
      return {
        type: 'strong_match_available',
        title: 'Notification',
        body: 'You have a new notification.',
        targetRoute: '/notifications',
        deepLink: '/notifications',
        metadata: data,
      }
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
  const copy = buildNotificationCopy(type, data)
  void createNotification({
    recipientId,
    ...copy,
    targetRoute: copy.targetRoute ?? undefined,
    deepLink: copy.deepLink ?? undefined,
    requestSource: copy.requestSource ?? undefined,
    metadata: copy.metadata ?? undefined,
  }).catch((error) => {
    console.error('[emitNotification] failed to persist notification', error)
  })
}

export async function listNotifications(
  recipientId: string,
): Promise<AppNotification[]> {
  const result = await query(
    `
      SELECT *
      FROM notifications
      WHERE recipient_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [recipientId],
  )
  return result.rows.map(mapAppNotification)
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
  if (
    !Number.isInteger(payload.rating) ||
    payload.rating < 1 ||
    payload.rating > 5
  ) {
    throw new HttpError(400, 'rating must be an integer between 1 and 5')
  }

  const eligibility = await getReviewEligibility(payload.tripId, payload.reviewerId)
  if (!eligibility.canSubmit) {
    const status = eligibility.reason === 'already_submitted' ? 409 : 400
    const message =
      eligibility.reason === 'outside_window'
        ? 'Review window has closed'
        : eligibility.reason === 'already_submitted'
          ? 'Review already exists for this trip'
          : `Review is not allowed: ${eligibility.reason}`
    throw new HttpError(status, message)
  }
  if (eligibility.revieweeId !== payload.revieweeId) {
    throw new HttpError(400, 'Reviewee must be the accepted counterpart')
  }

  try {
    const result = await query(
      `
        INSERT INTO reviews (id, trip_id, reviewer_id, reviewee_id, rating, comment, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *
      `,
      [
        generateId('review'),
        payload.tripId,
        payload.reviewerId,
        payload.revieweeId,
        payload.rating,
        payload.comment || null,
      ],
    )

    return toCamelCase<Review>(result.rows[0]) as Review
  } catch (error) {
    if (isPgUniqueViolation(error, 'reviews_unique_trip_reviewer_reviewee')) {
      throw new HttpError(409, 'Review already exists for this trip')
    }
    throw error
  }
}

export async function listReviewsByReviewer(userId: string): Promise<Review[]> {
  const result = await query(
    'SELECT * FROM reviews WHERE reviewer_id = $1 ORDER BY created_at DESC, id DESC',
    [userId],
  )
  return mapRows<Review>(result.rows)
}

export async function createReport(
  payload: CreateReportPayload,
): Promise<Report> {
  if (!VALID_REPORT_REASONS.has(payload.reason)) {
    throw new HttpError(400, 'Invalid report reason')
  }

  const result = await query(
    `
      INSERT INTO reports (id, trip_id, reporter_id, reportee_id, reason, detail, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `,
    [
      generateId('report'),
      payload.tripId,
      payload.reporterId,
      payload.reporteeId,
      payload.reason,
      payload.detail || null,
    ],
  )
  return toCamelCase<Report>(result.rows[0]) as Report
}

export async function listReportsByReporter(userId: string): Promise<Report[]> {
  const result = await query(
    'SELECT * FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC, id DESC',
    [userId],
  )
  return mapRows<Report>(result.rows)
}

export async function getBlockedUsers(blockerId: string): Promise<string[]> {
  const user = await getUser(blockerId)
  if (!user?.identityId) throw new HttpError(404, 'User not found')
  const result = await query(
    `
      SELECT u.id
      FROM identity_blocks b
      JOIN users u ON u.identity_id = b.blocked_identity_id
      WHERE b.blocker_identity_id = $1
      ORDER BY u.id
    `,
    [user.identityId],
  )
  return result.rows.map((row) => String(row.id))
}

export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<string[]> {
  const blocker = await getUser(blockerId)
  const blocked = await getUser(blockedId)
  if (!blocker?.identityId || !blocked?.identityId) {
    throw new HttpError(404, 'User not found')
  }
  await query(
    `
      INSERT INTO identity_blocks (blocker_identity_id, blocked_identity_id, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT DO NOTHING
    `,
    [blocker.identityId, blocked.identityId],
  )
  return getBlockedUsers(blockerId)
}

export async function unblockUser(
  blockerId: string,
  blockedId: string,
): Promise<string[]> {
  const blocker = await getUser(blockerId)
  const blocked = await getUser(blockedId)
  if (!blocker?.identityId || !blocked?.identityId) {
    throw new HttpError(404, 'User not found')
  }
  await query(
    `
      DELETE FROM identity_blocks
      WHERE blocker_identity_id = $1 AND blocked_identity_id = $2
    `,
    [blocker.identityId, blocked.identityId],
  )
  return getBlockedUsers(blockerId)
}

export async function createNotification(
  payload: CreateNotificationPayload,
): Promise<AppNotification> {
  const result = await query(
    `
      INSERT INTO notifications (
        id, recipient_id, type, title, body, target_route, deep_link,
        request_source, metadata, read, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW())
      RETURNING *
    `,
    [
      generateId('notif'),
      payload.recipientId,
      payload.type,
      payload.title,
      payload.body,
      payload.targetRoute || null,
      payload.deepLink || null,
      payload.requestSource || null,
      JSON.stringify(payload.metadata || {}),
    ],
  )
  return mapAppNotification(result.rows[0])
}

export async function markNotificationRead(
  recipientId: string,
  notificationId: string,
): Promise<AppNotification | null> {
  const result = await query(
    `
      UPDATE notifications
      SET read = TRUE, read_at = NOW()
      WHERE id = $1 AND recipient_id = $2
      RETURNING *
    `,
    [notificationId, recipientId],
  )
  return result.rows[0] ? mapAppNotification(result.rows[0]) : null
}

export async function markAllNotificationsRead(
  recipientId: string,
): Promise<void> {
  await query(
    `
      UPDATE notifications
      SET read = TRUE, read_at = NOW()
      WHERE recipient_id = $1 AND read = FALSE
    `,
    [recipientId],
  )
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

export async function createRoute(
  driverId: string,
  data: CreateRoutePayload,
): Promise<Route> {
  await assertUserRole(driverId, 'driver')
  assertServiceDateIsNotPast(data.serviceDate)

  const fields = data as unknown as Record<string, unknown>
  const origin = extractWardFields(fields, 'origin', data.origin)
  const dest = extractWardFields(fields, 'destination', data.destination)
  const departureWindow = computeDepartureBlock(data.departureTime)

  const res = await query(
    `
    INSERT INTO routes (
      id, driver_id, car_id, origin, destination, 
      origin_ward_key, origin_ward_id, origin_province_id,
      destination_ward_key, destination_ward_id, destination_province_id,
      service_date, departure_time, window_start, window_end, 
      trip_price, distance_meters, notes, status, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
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
      data.windowStart ? normalizeUtc(data.windowStart) : departureWindow.start,
      data.windowEnd ? normalizeUtc(data.windowEnd) : departureWindow.end,
      data.tripPrice,
      data.distanceMeters ?? null,
      data.notes || '',
      data.status || 'draft',
    ],
  )
  const route = mapRoute(res.rows[0])
  if (!route) throw new Error('Failed to create route')
  return route
}

async function hasReviewerSubmittedTripReview(
  tripId: string,
  reviewerId: string,
): Promise<boolean> {
  const result = await query(
    'SELECT 1 FROM reviews WHERE trip_id = $1 AND reviewer_id = $2 LIMIT 1',
    [tripId, reviewerId],
  )
  return result.rows.length > 0
}

function buildReviewEligibility(
  values: Partial<ReviewEligibility> & Pick<ReviewEligibility, 'reason'>,
): ReviewEligibility {
  return {
    canSubmit: values.reason === 'eligible',
    hasSubmitted: values.hasSubmitted ?? false,
    reason: values.reason,
    windowClosesAt: values.windowClosesAt ?? null,
    revieweeId: values.revieweeId ?? null,
  }
}

function getAcceptedCounterpartId(
  accepted: AcceptedJourneyMatch | null,
  viewerId: string,
): string | null {
  if (!accepted) return null
  const driverId =
    accepted.kind === 'route_request'
      ? accepted.request.driverId
      : accepted.offer.driverId
  const clientId =
    accepted.kind === 'route_request'
      ? accepted.request.clientId
      : accepted.offer.clientId
  if (viewerId === driverId) return clientId
  if (viewerId === clientId) return driverId
  return null
}

function getWindowClosesAt(completedAt?: string | null): string | null {
  if (!completedAt) return null
  const completedTime = new Date(completedAt).getTime()
  if (!Number.isFinite(completedTime)) return null
  return new Date(completedTime + 24 * 60 * 60 * 1000).toISOString()
}

export async function getReviewEligibility(
  tripId: string,
  viewerId: string,
  now: Date = new Date(),
): Promise<ReviewEligibility> {
  const route = await getRoute(tripId)
  const plan = route ? null : await getPlan(tripId)
  const trip = route ?? plan
  if (!trip) throw new HttpError(404, 'Trip not found')

  const accepted = route
    ? await findAcceptedRouteMatchTx({ query }, route.id)
    : await findAcceptedPlanMatchTx({ query }, plan!)
  const revieweeId = getAcceptedCounterpartId(accepted, viewerId)
  if (!accepted) return buildReviewEligibility({ reason: 'missing_counterpart' })
  if (!revieweeId) return buildReviewEligibility({ reason: 'not_participant' })

  const hasSubmitted = await hasReviewerSubmittedTripReview(trip.id, viewerId)
  const windowClosesAt = getWindowClosesAt(trip.completedAt)
  if (hasSubmitted) {
    return buildReviewEligibility({
      reason: 'already_submitted',
      hasSubmitted,
      windowClosesAt,
      revieweeId,
    })
  }
  if (trip.status !== 'completed') {
    return buildReviewEligibility({ reason: 'not_completed', revieweeId })
  }
  if (!trip.completedAt) {
    return buildReviewEligibility({ reason: 'missing_completed_at', revieweeId })
  }
  const completedTime = new Date(trip.completedAt).getTime()
  const nowTime = now.getTime()
  if (!Number.isFinite(completedTime) || completedTime > nowTime) {
    return buildReviewEligibility({ reason: 'missing_completed_at', revieweeId })
  }
  if (nowTime > completedTime + 24 * 60 * 60 * 1000) {
    return buildReviewEligibility({
      reason: 'outside_window',
      windowClosesAt,
      revieweeId,
    })
  }
  return buildReviewEligibility({
    reason: 'eligible',
    windowClosesAt,
    revieweeId,
  })
}

export async function withReviewEligibility<T extends Route | Plan>(
  trip: T,
  viewerId: string,
): Promise<WithReviewEligibility<T>> {
  return {
    ...trip,
    reviewEligibility: await getReviewEligibility(trip.id, viewerId),
  }
}

async function isTripVisibleInWorkQueue(
  trip: Pick<Route | Plan, 'id' | 'status' | 'serviceDate'>,
  reviewerId: string,
): Promise<boolean> {
  if (isActiveTripStatus(trip.status)) {
    return true
  }

  if (trip.status !== 'completed') {
    return false
  }

  return (await getReviewEligibility(trip.id, reviewerId)).canSubmit
}

async function shouldHideRequestForTerminalTrip(
  request:
    | Pick<RouteRequest, 'routeId' | 'planId'>
    | Pick<GroupOffer, 'routeId' | 'planId'>,
): Promise<boolean> {
  const route = await getRoute(request.routeId)
  if (isTerminalTripStatus(route?.status)) {
    return true
  }

  const plan = request.planId ? await getPlan(request.planId) : null
  return isTerminalTripStatus(plan?.status)
}

export async function getRoute(id: string): Promise<Route | null> {
  const result = await query('SELECT * FROM routes WHERE id = $1', [id])
  return result.rows[0] ? mapRoute(result.rows[0]) : null
}

export async function updateRoute(
  id: string,
  data: UpdateRoutePayload,
): Promise<Route | null> {
  const existing = await getRoute(id)
  if (!existing) return null

  assertServiceDateIsNotPast(data.serviceDate)

  if (
    existing.status === 'published' &&
    existing.walletFeeStatus &&
    existing.walletFeeStatus !== 'none' &&
    hasImmutablePublishedRouteFieldUpdate(data)
  ) {
    throw new HttpError(
      409,
      'Published fee-bearing route fields cannot be edited. Cancel and recreate the route instead.',
    )
  }

  const updated = await dynamicUpdate<Route>(
    'routes',
    id,
    data as unknown as Record<string, unknown>,
    ['origin', 'destination'],
  )
  return updated
    ? mapRoute(updated as unknown as Record<string, unknown>)
    : null
}

export async function publishRoute(
  id: string,
  data: UpdateRoutePayload = {},
): Promise<Route> {
  assertServiceDateIsNotPast(data.serviceDate)

  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, id, mapRoute)
    if (route.status === 'published') {
      return route
    }
    if (route.status !== 'draft') {
      throw new HttpError(
        409,
        `Cannot publish route in status: ${route.status}`,
      )
    }

    const nextValues = buildRouteWriteValues(route, data)
    const feeRequiredVnd = computeRouteFeeRequiredVnd(
      nextValues.distanceMeters ?? 0,
    )

    await reserveRouteFeeTx(tx, route, feeRequiredVnd, mapRoute, {
      description: 'Route fee reserved on publish',
    })

    const updatedRoute = await tx.query(
      `
      UPDATE routes
      SET car_id = $2,
          origin = $3,
          destination = $4,
          origin_ward_key = $5,
          origin_ward_id = $6,
          origin_province_id = $7,
          destination_ward_key = $8,
          destination_ward_id = $9,
          destination_province_id = $10,
          service_date = $11,
          departure_time = $12,
          window_start = $13,
          window_end = $14,
          trip_price = $15,
          distance_meters = $16,
          notes = $17,
          status = 'published'
      WHERE id = $1
      RETURNING *
    `,
      [
        id,
        nextValues.carId,
        JSON.stringify(nextValues.origin),
        JSON.stringify(nextValues.destination),
        nextValues.originWardKey,
        nextValues.originWardId,
        nextValues.originProvinceId,
        nextValues.destinationWardKey,
        nextValues.destinationWardId,
        nextValues.destinationProvinceId,
        nextValues.serviceDate,
        nextValues.departureTime,
        nextValues.windowStart,
        nextValues.windowEnd,
        nextValues.tripPrice,
        nextValues.distanceMeters,
        nextValues.notes,
      ],
    )

    return mapRoute(updatedRoute.rows[0])
  })
}

export async function listAllRoutes(): Promise<Route[]> {
  const result = await query('SELECT * FROM routes')
  return result.rows.map(mapRoute)
}

// --- Plan ---

export async function createPlan(
  clientId: string,
  data: CreatePlanPayload,
): Promise<Plan> {
  await assertUserRole(clientId, 'client')
  assertServiceDateIsNotPast(data.serviceDate)

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
      'grouped',
      data.notes || '',
      data.status || 'published',
    ],
  )
  const plan = toCamelCase<Plan>(res.rows[0])
  if (!plan) throw new Error('Failed to create plan')
  return plan
}

export async function getPlan(id?: string): Promise<Plan | null> {
  if (!id) return null
  const result = await query('SELECT * FROM plans WHERE id = $1', [id])
  return toCamelCase<Plan>(result.rows[0])
}

export async function updatePlan(
  id: string,
  data: UpdatePlanPayload,
): Promise<Plan | null> {
  assertServiceDateIsNotPast(data.serviceDate)

  return dynamicUpdate<Plan>(
    'plans',
    id,
    data as unknown as Record<string, unknown>,
    ['pickup', 'dropoff'],
  )
}

export async function cancelPlanByClient(
  planId: string,
  clientId: string,
): Promise<Plan> {
  return withTransaction(async (tx) => {
    const planRes = await tx.query(
      'SELECT * FROM plans WHERE id = $1 FOR UPDATE',
      [planId],
    )
    const plan = toCamelCase<Plan>(planRes.rows[0])
    if (!plan) {
      throw new HttpError(404, 'Plan not found')
    }
    if (plan.clientId !== clientId) {
      throw new HttpError(403, 'Client does not own this plan')
    }
    if (plan.status === 'canceled') {
      return plan
    }

    const accepted = await findAcceptedPlanMatchTx(tx, plan)
    if (accepted) {
      throw new HttpError(409, 'Cannot cancel an accepted plan')
    }

    const updatedPlan = await tx.query(
      "UPDATE plans SET status = 'canceled' WHERE id = $1 RETURNING *",
      [plan.id],
    )
    const canceledPlan = toCamelCase<Plan>(updatedPlan.rows[0])
    if (!canceledPlan) throw new Error('Failed to cancel plan')
    return canceledPlan
  })
}

const listRoutesByDriverRaw = listByColumn<Route>('routes', 'driver_id')

export type TripListScope = 'active' | 'history'

function normalizeTripListScope(scope?: string): TripListScope {
  return scope === 'history' ? 'history' : 'active'
}

function isTripVisibleInHistory(trip: Pick<Route | Plan, 'status'>): boolean {
  return isTerminalTripStatus(trip.status)
}

async function filterTripsByScope<
  T extends Pick<Route | Plan, 'id' | 'status' | 'serviceDate'>,
>(trips: T[], scope: TripListScope, viewerId: string): Promise<T[]> {
  if (normalizeTripListScope(scope) === 'history') {
    return trips.filter(isTripVisibleInHistory)
  }
  const visibility = await Promise.all(
    trips.map((trip) => isTripVisibleInWorkQueue(trip, viewerId)),
  )
  return trips.filter((_, index) => visibility[index])
}

export async function listRoutesByDriver(
  driverId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Route>>> {
  await assertUserRole(driverId, 'driver')
  const routes = await listRoutesByDriverRaw(driverId)
  const filtered = await filterTripsByScope(routes, scope, driverId)
  return Promise.all(filtered.map((route) => withReviewEligibility(route, driverId)))
}

const listPlansByClientRaw = listByColumn<Plan>('plans', 'client_id')

export async function listPlansByClient(
  clientId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Plan>>> {
  await assertUserRole(clientId, 'client')
  const plans = await listPlansByClientRaw(clientId)
  const filtered = await filterTripsByScope(plans, scope, clientId)
  return Promise.all(filtered.map((plan) => withReviewEligibility(plan, clientId)))
}

// --- Departure Block ---

export function computeDepartureBlock(departureTime: string | Date): {
  start: string
  end: string
} {
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

const ROUTE_ACCEPTED_SQL = `
  SELECT 1 FROM group_offers WHERE route_id = $1 AND status = 'accepted'
  UNION ALL
  SELECT 1 FROM route_requests WHERE route_id = $1 AND status = 'accepted'
`

export async function checkRouteAvailability(
  executor: {
    query: (
      sql: string,
      params: unknown[],
    ) => Promise<{ rowCount: number | null }>
  },
  routeId: string,
): Promise<boolean> {
  const result = await executor.query(ROUTE_ACCEPTED_SQL, [routeId])
  return result.rowCount === 0
}

export async function isRouteAvailable(routeId: string): Promise<boolean> {
  return checkRouteAvailability({ query }, routeId)
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
  const routeRequestDomainService = require('./services/routeRequestService') as typeof import('./services/routeRequestService')
  return routeRequestDomainService.createRouteRequest(clientId, planId, routeId, note)
}

export async function acceptRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  const routeRequestDomainService = require('./services/routeRequestService') as typeof import('./services/routeRequestService')
  return routeRequestDomainService.acceptRouteRequest(requestId)
}

type AcceptedJourneyMatch =
  | { kind: 'route_request'; request: RouteRequest }
  | { kind: 'group_offer'; offer: GroupOffer }

async function findAcceptedRouteMatchTx(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<AcceptedJourneyMatch | null> {
  const searchRes = await executor.query(
    `
    SELECT *
    FROM route_requests
    WHERE route_id = $1 AND status = 'accepted'
    FOR UPDATE
  `,
    [routeId],
  )
  const acceptedSearch = mapRows<RouteRequest>(searchRes.rows)[0]
  if (acceptedSearch) {
    return { kind: 'route_request', request: acceptedSearch }
  }

  const offerRes = await executor.query(
    `
    SELECT *
    FROM group_offers
    WHERE route_id = $1 AND status = 'accepted'
    FOR UPDATE
  `,
    [routeId],
  )
  const acceptedOffer = mapRows<GroupOffer>(offerRes.rows)[0]
  if (acceptedOffer) {
    return { kind: 'group_offer', offer: acceptedOffer }
  }

  return null
}

async function findAcceptedPlanMatchTx(
  executor: DbQueryExecutor,
  plan: Plan,
): Promise<AcceptedJourneyMatch | null> {
  const searchRes = await executor.query(
    `
    SELECT *
    FROM route_requests
    WHERE client_id = $1 AND plan_id = $2 AND status IN ('pending', 'accepted')
    FOR UPDATE
  `,
    [plan.clientId, plan.id],
  )
  const acceptedSearch = mapRows<RouteRequest>(searchRes.rows).find(
    (request) => request.status === 'accepted',
  )
  if (acceptedSearch) {
    return { kind: 'route_request', request: acceptedSearch }
  }

  const offerRes = await executor.query(
    `
    SELECT *
    FROM group_offers
    WHERE client_id = $1 AND plan_id = $2 AND status IN ('pending', 'accepted')
    FOR UPDATE
  `,
    [plan.clientId, plan.id],
  )
  const acceptedOffer = mapRows<GroupOffer>(offerRes.rows).find(
    (offer) => offer.status === 'accepted',
  )
  if (acceptedOffer) {
    return { kind: 'group_offer', offer: acceptedOffer }
  }

  return null
}

async function unwindRouteFeeOnMatchedCancel(
  executor: DbQueryExecutor,
  route: Route,
): Promise<Route> {
  switch (route.walletFeeStatus) {
    case 'charged':
      return refundRouteFeeTx(executor, route, mapRoute, {
        description: 'Route fee refunded on trip cancel',
      })
    case 'reserved':
      return releaseRouteFeeTx(executor, route, mapRoute, {
        description: 'Route fee released on trip cancel',
      })
    case 'refunded':
    case 'released':
    case 'none':
      return route
    default:
      throw new HttpError(
        409,
        `Cannot cancel matched route in fee state: ${route.walletFeeStatus}`,
      )
  }
}

async function cancelAcceptedJourneyMatchTx(
  executor: DbQueryExecutor,
  accepted: AcceptedJourneyMatch,
): Promise<void> {
  if (accepted.kind === 'route_request') {
    await executor.query(
      "UPDATE route_requests SET status = 'canceled' WHERE id = $1",
      [accepted.request.id],
    )
  } else {
    await executor.query(
      "UPDATE group_offers SET status = 'canceled' WHERE id = $1",
      [accepted.offer.id],
    )
  }
}

async function cancelRouteTripTx(
  executor: DbQueryExecutor,
  route: Route,
): Promise<Route> {
  if (route.status === 'canceled') {
    return route
  }

  const accepted = await findAcceptedRouteMatchTx(executor, route.id)
  if (accepted) {
    route = await unwindRouteFeeOnMatchedCancel(executor, route)
    await cancelAcceptedJourneyMatchTx(executor, accepted)
  } else if (route.walletFeeStatus === 'reserved') {
    route = await releaseRouteFeeTx(executor, route, mapRoute, {
      description: 'Route fee released on route cancel',
    })
  } else if (route.walletFeeStatus === 'charged') {
    throw new HttpError(
      409,
      'Cannot cancel an unmatched route after the fee has already been charged',
    )
  }

  const updatedRoute = await executor.query(
    "UPDATE routes SET status = 'canceled' WHERE id = $1 RETURNING *",
    [route.id],
  )
  return mapRoute(updatedRoute.rows[0])
}

async function cancelPlanTripTx(
  executor: DbQueryExecutor,
  plan: Plan,
): Promise<Plan> {
  if (plan.status === 'canceled') {
    return plan
  }

  const accepted = await findAcceptedPlanMatchTx(executor, plan)
  if (accepted) {
    const routeId =
      accepted.kind === 'route_request'
        ? accepted.request.routeId
        : accepted.offer.routeId
    const route = await loadRouteForWalletTx(executor, routeId, mapRoute)
    await unwindRouteFeeOnMatchedCancel(executor, route)
    await cancelAcceptedJourneyMatchTx(executor, accepted)
  }

  const updatedPlan = await executor.query(
    "UPDATE plans SET status = 'canceled' WHERE id = $1 RETURNING *",
    [plan.id],
  )
  const canceledPlan = toCamelCase<Plan>(updatedPlan.rows[0])
  if (!canceledPlan) throw new Error('Failed to cancel plan')
  return canceledPlan
}

export async function cancelTrip(tripId: string): Promise<Route | Plan> {
  return withTransaction(async (tx) => {
    const routeRes = await tx.query(
      'SELECT * FROM routes WHERE id = $1 FOR UPDATE',
      [tripId],
    )
    if (routeRes.rows[0]) {
      const route = mapRoute(routeRes.rows[0])
      return cancelRouteTripTx(tx, route)
    }

    const planRes = await tx.query(
      'SELECT * FROM plans WHERE id = $1 FOR UPDATE',
      [tripId],
    )
    const plan = toCamelCase<Plan>(planRes.rows[0])
    if (plan) {
      return cancelPlanTripTx(tx, plan)
    }

    throw new HttpError(404, 'Trip not found')
  })
}

export async function completeTrip(tripId: string): Promise<Route | Plan> {
  return withTransaction(async (tx) => {
    const completedAt = new Date()
    const routeRes = await tx.query(
      'SELECT * FROM routes WHERE id = $1 FOR UPDATE',
      [tripId],
    )
    const route = routeRes.rows[0] ? mapRoute(routeRes.rows[0]) : null
    if (route) {
      const accepted = await findAcceptedRouteMatchTx(tx, route.id)
      const updatedRouteRes = await tx.query(
        "UPDATE routes SET status = 'completed', completed_at = $2 WHERE id = $1 RETURNING *",
        [route.id, completedAt],
      )
      if (accepted?.kind === 'route_request' && accepted.request.planId) {
        await tx.query(
          "UPDATE plans SET status = 'completed', completed_at = $2 WHERE id = $1",
          [accepted.request.planId, completedAt],
        )
      }
      if (accepted?.kind === 'group_offer' && accepted.offer.planId) {
        await tx.query(
          "UPDATE plans SET status = 'completed', completed_at = $2 WHERE id = $1",
          [accepted.offer.planId, completedAt],
        )
      }
      return mapRoute(updatedRouteRes.rows[0])
    }

    const planRes = await tx.query(
      'SELECT * FROM plans WHERE id = $1 FOR UPDATE',
      [tripId],
    )
    const plan = planRes.rows[0] ? toCamelCase<Plan>(planRes.rows[0]) : null
    if (plan) {
      const accepted = await findAcceptedPlanMatchTx(tx, plan)
      const updatedPlanRes = await tx.query(
        "UPDATE plans SET status = 'completed', completed_at = $2 WHERE id = $1 RETURNING *",
        [plan.id, completedAt],
      )
      if (accepted?.kind === 'route_request') {
        await tx.query(
          "UPDATE routes SET status = 'completed', completed_at = $2 WHERE id = $1",
          [accepted.request.routeId, completedAt],
        )
      }
      if (accepted?.kind === 'group_offer') {
        await tx.query(
          "UPDATE routes SET status = 'completed', completed_at = $2 WHERE id = $1",
          [accepted.offer.routeId, completedAt],
        )
      }
      const updatedPlan = toCamelCase<Plan>(updatedPlanRes.rows[0])
      if (!updatedPlan) throw new Error('Failed to complete plan')
      return updatedPlan
    }

    throw new HttpError(404, 'Trip not found')
  })
}

export async function declineRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  const routeRequestDomainService = require('./services/routeRequestService') as typeof import('./services/routeRequestService')
  return routeRequestDomainService.declineRouteRequest(requestId)
}

export async function cancelRouteRequest(
  requestId: string,
): Promise<RouteRequest> {
  const routeRequestDomainService = require('./services/routeRequestService') as typeof import('./services/routeRequestService')
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
  const routeRequestDomainService = require('./services/routeRequestService') as typeof import('./services/routeRequestService')
  return routeRequestDomainService.listRouteRequestsByDriver(driverId)
}

export async function listRouteRequestsByClient(
  clientId: string,
): Promise<RouteRequest[]> {
  const routeRequestDomainService = require('./services/routeRequestService') as typeof import('./services/routeRequestService')
  return routeRequestDomainService.listRouteRequestsByClient(clientId)
}

export async function listRouteRequestsByPlan(
  planId: string,
): Promise<RouteRequest[]> {
  const requestsRes = await query(
    'SELECT * FROM route_requests WHERE plan_id = $1 ORDER BY created_at DESC, id DESC',
    [planId],
  )
  return mapRows<RouteRequest>(requestsRes.rows)
}

export async function listGroupOffersByPlan(
  planId: string,
): Promise<GroupOffer[]> {
  const offersRes = await query(
    'SELECT * FROM group_offers WHERE plan_id = $1 ORDER BY created_at DESC, id DESC',
    [planId],
  )
  return mapRows<GroupOffer>(offersRes.rows)
}

export const listRouteRequestsByRoute = listByColumn<RouteRequest>(
  'route_requests',
  'route_id',
)
export const listGroupOffersByRoute = listByColumn<GroupOffer>(
  'group_offers',
  'route_id',
)

// --- Deprecated: saved locations ---

function parseLocationRow(row: Record<string, unknown>): SavedLocation {
  const loc = toCamelCase<SavedLocation>(row)
  if (!loc) throw new Error('Cannot map null row to SavedLocation')
  loc.lat = parseFloat(String(loc.lat))
  loc.lng = parseFloat(String(loc.lng))
  return loc
}

export async function createSavedLocation(payload: {
  label: string
  lat: number
  lng: number
}): Promise<SavedLocation> {
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

export async function listSavedLocations(): Promise<SavedLocation[]> {
  const result = await query('SELECT * FROM saved_locations')
  return result.rows.map(parseLocationRow)
}

export async function deleteSavedLocation(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM saved_locations WHERE id = $1 RETURNING id',
    [id],
  )
  return result.rowCount !== null && result.rowCount > 0
}
