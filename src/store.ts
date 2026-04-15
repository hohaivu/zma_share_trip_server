import { query, withTransaction } from './db/connection'
import { mapRows, normalizeUtc, parseNumeric, toCamelCase } from './db/utils'
import { HttpError } from './http-error'
import {
  Car,
  GroupOffer,
  GroupRequest,
  Location,
  Plan,
  Route,
  SavedLocation,
  SearchRequest,
  Wallet,
  WalletTransaction,
  User,
} from './types/entities'
import {
  BootstrapResult,
  CreateCarPayload,
  CreatePlanPayload,
  CreateRoutePayload,
  DemandGroupSummary,
  ManualTopUpPayload,
  ManualTopUpResult,
  UpdateCarPayload,
  UpdatePlanPayload,
  UpdateRoutePayload,
  WalletSummary,
} from './types/payloads'

// --- Helpers ---

function isPgUniqueViolation(e: unknown, constraint: string): boolean {
  const err = e as Record<string, unknown>
  return err?.code === '23505' && err?.constraint === constraint
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

export function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
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
}

export function mapCar(
  row: Record<string, unknown>,
): Car & { colorHex?: string } {
  const c = toCamelCase<Car & { colorHex?: string }>(row)
  if (!c) throw new Error('Cannot map null row to Car')
  if (c.color) c.colorHex = CAR_COLORS[c.color] || c.color
  return c
}

// --- Wallet ---

const DEFAULT_WALLET_FEE_VND_PER_KM = 500
const DEFAULT_WALLET_TRANSACTION_LIMIT = 20

type DbQueryExecutor = {
  query: (
    sql: string,
    params: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}

function getWalletFeeRateVndPerKm(): number {
  const raw = process.env.WALLET_FEE_VND_PER_KM
  const parsed = raw ? Number(raw) : DEFAULT_WALLET_FEE_VND_PER_KM
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WALLET_FEE_VND_PER_KM
  }
  return Math.floor(parsed)
}

function mapWallet(row: Record<string, unknown>): Wallet {
  const wallet = toCamelCase<Wallet>(row)
  if (!wallet) throw new Error('Cannot map null row to Wallet')
  wallet.balanceVnd = parseNumeric(wallet.balanceVnd)
  wallet.reservedBalanceVnd = parseNumeric(wallet.reservedBalanceVnd)
  return wallet
}

function mapWalletTransaction(row: Record<string, unknown>): WalletTransaction {
  const transaction = toCamelCase<WalletTransaction>(row)
  if (!transaction) throw new Error('Cannot map null row to WalletTransaction')
  transaction.amountVnd = parseNumeric(transaction.amountVnd)
  transaction.balanceAfterVnd = parseNumeric(transaction.balanceAfterVnd)
  transaction.reservedBalanceAfterVnd = parseNumeric(
    transaction.reservedBalanceAfterVnd,
  )
  return transaction
}

function mapRoute(row: Record<string, unknown>): Route {
  const route = toCamelCase<Route>(row)
  if (!route) throw new Error('Cannot map null row to Route')
  route.tripPrice = parseNumeric(route.tripPrice)
  route.feeRequiredVnd = parseNumeric(route.feeRequiredVnd)
  return route
}

export function computeAvailableBalanceVnd(
  wallet: Pick<Wallet, 'balanceVnd' | 'reservedBalanceVnd'>,
): number {
  return wallet.balanceVnd - wallet.reservedBalanceVnd
}

function computeMaxPublishableDistanceMeters(
  availableBalanceVnd: number,
  feeRateVndPerKm: number,
): number {
  if (feeRateVndPerKm <= 0) return 0
  return (
    Math.max(
      0,
      Math.floor(Math.max(availableBalanceVnd, 0) / feeRateVndPerKm),
    ) * 1000
  )
}

function buildWalletSummary(wallet: Wallet): WalletSummary {
  const feeRateVndPerKm = getWalletFeeRateVndPerKm()
  const availableBalanceVnd = computeAvailableBalanceVnd(wallet)
  return {
    ...wallet,
    availableBalanceVnd,
    feeRateVndPerKm,
    maxPublishableDistanceMeters: computeMaxPublishableDistanceMeters(
      availableBalanceVnd,
      feeRateVndPerKm,
    ),
  }
}

async function getOrCreateDriverWalletTx(
  executor: DbQueryExecutor,
  driverId: string,
): Promise<Wallet> {
  const existing = await executor.query(
    'SELECT * FROM wallets WHERE driver_id = $1 FOR UPDATE',
    [driverId],
  )
  if (existing.rowCount && existing.rows[0]) {
    return mapWallet(existing.rows[0])
  }

  try {
    const inserted = await executor.query(
      `
      INSERT INTO wallets (
        id, driver_id, balance_vnd, reserved_balance_vnd, created_at, updated_at
      )
      VALUES ($1, $2, 0, 0, NOW(), NOW())
      RETURNING *
    `,
      [generateId('wallet'), driverId],
    )
    return mapWallet(inserted.rows[0])
  } catch (error) {
    if ((error as Record<string, unknown>)?.code === '23505') {
      const retry = await executor.query(
        'SELECT * FROM wallets WHERE driver_id = $1 FOR UPDATE',
        [driverId],
      )
      if (retry.rowCount && retry.rows[0]) {
        return mapWallet(retry.rows[0])
      }
    }
    throw error
  }
}

async function updateWalletRowTx(
  executor: DbQueryExecutor,
  walletId: string,
  data: Partial<Pick<Wallet, 'balanceVnd' | 'reservedBalanceVnd'>>,
): Promise<Wallet> {
  const updated = await executor.query(
    `
    UPDATE wallets
    SET balance_vnd = COALESCE($2, balance_vnd),
        reserved_balance_vnd = COALESCE($3, reserved_balance_vnd),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
    [walletId, data.balanceVnd ?? null, data.reservedBalanceVnd ?? null],
  )
  const wallet = mapWallet(updated.rows[0])
  if (!wallet) throw new Error('Failed to update wallet')
  return wallet
}

async function insertWalletTransactionTx(
  executor: DbQueryExecutor,
  data: {
    walletId: string
    driverId: string
    routeId?: string | null
    type: WalletTransaction['type']
    amountVnd: number
    balanceAfterVnd: number
    reservedBalanceAfterVnd: number
    description?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<WalletTransaction> {
  const result = await executor.query(
    `
    INSERT INTO wallet_transactions (
      id, wallet_id, driver_id, route_id, type, amount_vnd,
      balance_after_vnd, reserved_balance_after_vnd, description, metadata, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    RETURNING *
  `,
    [
      generateId('wtx'),
      data.walletId,
      data.driverId,
      data.routeId || null,
      data.type,
      data.amountVnd,
      data.balanceAfterVnd,
      data.reservedBalanceAfterVnd,
      data.description ?? null,
      JSON.stringify(data.metadata || {}),
    ],
  )
  const transaction = mapWalletTransaction(result.rows[0])
  if (!transaction) throw new Error('Failed to create wallet transaction')
  return transaction
}

async function loadRouteForWalletTx(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<Route> {
  const result = await executor.query(
    'SELECT * FROM routes WHERE id = $1 FOR UPDATE',
    [routeId],
  )
  const route = mapRoute(result.rows[0])
  if (!route) throw new HttpError(404, 'Route not found')
  return route
}

function assertDriverOwnsRoute(route: Route, driverId: string): void {
  if (route.driverId !== driverId) {
    throw new HttpError(404, 'Route not found')
  }
}

function computeRouteFeeRequiredVnd(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new HttpError(400, 'distanceMeters must be a positive integer')
  }
  if (!Number.isInteger(distanceMeters)) {
    throw new HttpError(400, 'distanceMeters must be a whole number')
  }

  return Math.ceil((distanceMeters / 1000) * getWalletFeeRateVndPerKm())
}

async function reserveRouteFeeTx(
  executor: DbQueryExecutor,
  route: Route,
  feeRequiredVnd: number,
  meta?: { description?: string },
): Promise<Route> {
  if (!Number.isFinite(feeRequiredVnd) || feeRequiredVnd < 0) {
    throw new HttpError(400, 'Route fee must be a non-negative number')
  }
  if (!Number.isInteger(feeRequiredVnd)) {
    throw new HttpError(400, 'Route fee must be a whole number')
  }
  if (route.walletFeeStatus === 'reserved') {
    return route
  }
  if (route.walletFeeStatus && route.walletFeeStatus !== 'none') {
    throw new HttpError(
      409,
      `Cannot reserve fee in route fee state: ${route.walletFeeStatus}`,
    )
  }

  const wallet = await getOrCreateDriverWalletTx(executor, route.driverId)
  const availableBalanceVnd = computeAvailableBalanceVnd(wallet)
  if (availableBalanceVnd < feeRequiredVnd) {
    throw new HttpError(400, 'Insufficient wallet balance to reserve route fee')
  }

  const updatedWallet = await updateWalletRowTx(executor, wallet.id, {
    reservedBalanceVnd: wallet.reservedBalanceVnd + feeRequiredVnd,
  })

  await insertWalletTransactionTx(executor, {
    walletId: wallet.id,
    driverId: route.driverId,
    routeId: route.id,
    type: 'reservation',
    amountVnd: feeRequiredVnd,
    balanceAfterVnd: updatedWallet.balanceVnd,
    reservedBalanceAfterVnd: updatedWallet.reservedBalanceVnd,
    description: meta?.description || 'Route fee reserved',
    metadata: {
      feeRequiredVnd,
      feeRateVndPerKm: getWalletFeeRateVndPerKm(),
    },
  })

  const feeRateVndPerKm = getWalletFeeRateVndPerKm()
  const updatedRoute = await executor.query(
    `
    UPDATE routes
    SET fee_rate_vnd_per_km = $1,
        fee_required_vnd = $2,
        wallet_fee_status = 'reserved',
        wallet_reserved_at = NOW()
    WHERE id = $3
    RETURNING *
  `,
    [feeRateVndPerKm, feeRequiredVnd, route.id],
  )
  return mapRoute(updatedRoute.rows[0])
}

async function releaseRouteFeeTx(
  executor: DbQueryExecutor,
  route: Route,
  meta?: { description?: string },
): Promise<Route> {
  if (route.walletFeeStatus === 'released') {
    return route
  }
  if (route.walletFeeStatus !== 'reserved') {
    throw new HttpError(
      409,
      `Cannot release fee in route fee state: ${route.walletFeeStatus}`,
    )
  }

  const wallet = await getOrCreateDriverWalletTx(executor, route.driverId)
  const feeRequiredVnd = route.feeRequiredVnd || 0
  const updatedWallet = await updateWalletRowTx(executor, wallet.id, {
    reservedBalanceVnd: wallet.reservedBalanceVnd - feeRequiredVnd,
  })

  await insertWalletTransactionTx(executor, {
    walletId: wallet.id,
    driverId: route.driverId,
    routeId: route.id,
    type: 'release',
    amountVnd: feeRequiredVnd,
    balanceAfterVnd: updatedWallet.balanceVnd,
    reservedBalanceAfterVnd: updatedWallet.reservedBalanceVnd,
    description: meta?.description || 'Route fee released',
    metadata: {
      feeRequiredVnd,
    },
  })

  const updatedRoute = await executor.query(
    `
    UPDATE routes
    SET wallet_fee_status = 'released',
        wallet_released_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
    [route.id],
  )
  return mapRoute(updatedRoute.rows[0])
}

async function chargeRouteFeeTx(
  executor: DbQueryExecutor,
  route: Route,
  meta?: { description?: string },
): Promise<Route> {
  if (route.walletFeeStatus === 'charged') {
    return route
  }
  if (route.walletFeeStatus !== 'reserved') {
    throw new HttpError(
      409,
      `Cannot charge fee in route fee state: ${route.walletFeeStatus}`,
    )
  }

  const wallet = await getOrCreateDriverWalletTx(executor, route.driverId)
  const feeRequiredVnd = route.feeRequiredVnd || 0
  const updatedWallet = await updateWalletRowTx(executor, wallet.id, {
    balanceVnd: wallet.balanceVnd - feeRequiredVnd,
    reservedBalanceVnd: wallet.reservedBalanceVnd - feeRequiredVnd,
  })

  await insertWalletTransactionTx(executor, {
    walletId: wallet.id,
    driverId: route.driverId,
    routeId: route.id,
    type: 'charge',
    amountVnd: feeRequiredVnd,
    balanceAfterVnd: updatedWallet.balanceVnd,
    reservedBalanceAfterVnd: updatedWallet.reservedBalanceVnd,
    description: meta?.description || 'Route fee charged',
    metadata: {
      feeRequiredVnd,
    },
  })

  const updatedRoute = await executor.query(
    `
    UPDATE routes
    SET wallet_fee_status = 'charged',
        wallet_charged_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
    [route.id],
  )
  return mapRoute(updatedRoute.rows[0])
}

async function refundRouteFeeTx(
  executor: DbQueryExecutor,
  route: Route,
  meta?: { description?: string },
): Promise<Route> {
  if (route.walletFeeStatus === 'refunded') {
    return route
  }
  if (route.walletFeeStatus !== 'charged') {
    throw new HttpError(
      409,
      `Cannot refund fee in route fee state: ${route.walletFeeStatus}`,
    )
  }

  const wallet = await getOrCreateDriverWalletTx(executor, route.driverId)
  const feeRequiredVnd = route.feeRequiredVnd || 0
  const updatedWallet = await updateWalletRowTx(executor, wallet.id, {
    balanceVnd: wallet.balanceVnd + feeRequiredVnd,
  })

  await insertWalletTransactionTx(executor, {
    walletId: wallet.id,
    driverId: route.driverId,
    routeId: route.id,
    type: 'refund',
    amountVnd: feeRequiredVnd,
    balanceAfterVnd: updatedWallet.balanceVnd,
    reservedBalanceAfterVnd: updatedWallet.reservedBalanceVnd,
    description: meta?.description || 'Route fee refunded',
    metadata: {
      feeRequiredVnd,
    },
  })

  const updatedRoute = await executor.query(
    `
    UPDATE routes
    SET wallet_fee_status = 'refunded',
        wallet_refunded_at = NOW()
    WHERE id = $1
    RETURNING *
  `,
    [route.id],
  )
  return mapRoute(updatedRoute.rows[0])
}

export async function getOrCreateDriverWallet(
  driverId: string,
): Promise<Wallet> {
  return withTransaction((tx) => getOrCreateDriverWalletTx(tx, driverId))
}

export async function getDriverWalletSummary(
  driverId: string,
): Promise<WalletSummary> {
  const wallet = await getOrCreateDriverWallet(driverId)
  return buildWalletSummary(wallet)
}

export async function listDriverWalletTransactions(
  driverId: string,
  limit?: number,
): Promise<WalletTransaction[]> {
  const txLimit = Math.max(
    1,
    Math.min(100, Math.floor(limit ?? DEFAULT_WALLET_TRANSACTION_LIMIT)),
  )
  const result = await query(
    `
    SELECT *
    FROM wallet_transactions
    WHERE driver_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2
  `,
    [driverId, txLimit],
  )
  return result.rows.map(mapWalletTransaction)
}

export async function topUpDriverWallet(
  driverId: string,
  payload: ManualTopUpPayload,
): Promise<ManualTopUpResult> {
  if (!Number.isFinite(payload.amountVnd) || payload.amountVnd <= 0) {
    throw new HttpError(400, 'Top-up amount must be greater than zero')
  }
  if (!Number.isInteger(payload.amountVnd)) {
    throw new HttpError(400, 'Top-up amount must be a whole number')
  }

  const result = await withTransaction(async (tx) => {
    const wallet = await getOrCreateDriverWalletTx(tx, driverId)
    const updatedWallet = await updateWalletRowTx(tx, wallet.id, {
      balanceVnd: wallet.balanceVnd + payload.amountVnd,
    })
    const transaction = await insertWalletTransactionTx(tx, {
      walletId: wallet.id,
      driverId,
      type: 'topup',
      amountVnd: payload.amountVnd,
      balanceAfterVnd: updatedWallet.balanceVnd,
      reservedBalanceAfterVnd: updatedWallet.reservedBalanceVnd,
      description: payload.description || 'Manual top-up',
      metadata: {
        source: 'manual_top_up',
      },
    })
    return { summary: buildWalletSummary(updatedWallet), transaction }
  })

  return result
}

export async function reserveRouteFee(
  routeId: string,
  driverId: string,
  feeRequiredVnd: number,
  meta?: { description?: string },
): Promise<Route> {
  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, routeId)
    assertDriverOwnsRoute(route, driverId)
    return reserveRouteFeeTx(tx, route, feeRequiredVnd, meta)
  })
}

export async function releaseRouteFee(
  routeId: string,
  driverId: string,
  meta?: { description?: string },
): Promise<Route> {
  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, routeId)
    if (route.driverId !== driverId) {
      throw new HttpError(404, 'Route not found')
    }
    return releaseRouteFeeTx(tx, route, meta)
  })
}

export async function chargeRouteFee(
  routeId: string,
  driverId: string,
  meta?: { description?: string },
): Promise<Route> {
  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, routeId)
    if (route.driverId !== driverId) {
      throw new HttpError(404, 'Route not found')
    }
    return chargeRouteFeeTx(tx, route, meta)
  })
}

export async function refundRouteFee(
  routeId: string,
  driverId: string,
  meta?: { description?: string },
): Promise<Route> {
  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, routeId)
    if (route.driverId !== driverId) {
      throw new HttpError(404, 'Route not found')
    }
    return refundRouteFeeTx(tx, route, meta)
  })
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

export interface NotificationPayload {
  type: string
  recipientId: string
  data: Record<string, unknown>
  createdAt: string
}

const notifications: NotificationPayload[] = []

export function emitNotification(
  type: string,
  recipientId: string,
  data: Record<string, unknown>,
): void {
  notifications.push({
    type,
    recipientId,
    data,
    createdAt: new Date().toISOString(),
  })
}

export function listNotifications(): NotificationPayload[] {
  return [...notifications]
}

// --- User ---

export async function getUser(userId: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE id = $1', [userId])
  return toCamelCase<User>(result.rows[0])
}

export async function setUserMode(
  userId: string,
  mode: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  const result = await query(
    'UPDATE users SET preferred_mode = $1, mode_selected_at = NOW() WHERE id = $2 RETURNING preferred_mode, mode_selected_at',
    [mode, userId],
  )
  if (result.rowCount === 0) return null
  return toCamelCase<{ preferredMode: string; modeSelectedAt: string }>(
    result.rows[0],
  )
}

export async function getUserMode(
  userId: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  const result = await query(
    'SELECT preferred_mode, mode_selected_at FROM users WHERE id = $1',
    [userId],
  )
  if (result.rowCount === 0) return null
  return toCamelCase<{ preferredMode: string; modeSelectedAt: string }>(
    result.rows[0],
  )
}

export async function bootstrapUser(
  mauid: string,
  displayName?: string,
  avatarUrl?: string,
): Promise<BootstrapResult> {
  // Look up existing user by mauid
  const existing = await query('SELECT * FROM users WHERE mauid = $1', [mauid])
  if (existing.rows.length > 0) {
    // Update display fields on subsequent bootstrap calls
    const updated = await query(
      `UPDATE users SET display_name = $1, avatar_url = $2 WHERE mauid = $3 RETURNING *`,
      [
        displayName || existing.rows[0].display_name,
        avatarUrl ?? existing.rows[0].avatar_url,
        mauid,
      ],
    )
    const user = toCamelCase<User>(updated.rows[0])
    if (!user) throw new Error('Failed to update user')
    return { user, wasCreated: false }
  }

  // Create new user with auto-generated UUID id
  const result = await query(
    `
    INSERT INTO users (mauid, display_name, avatar_url, role, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING *
  `,
    [mauid, displayName || '', avatarUrl || '', 'client'],
  )
  const user = toCamelCase<User>(result.rows[0])
  if (!user) throw new Error('Failed to bootstrap user')
  return { user, wasCreated: true }
}

// --- Car ---

export async function createCar(
  ownerId: string,
  data: CreateCarPayload,
): Promise<Car & { colorHex?: string }> {
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
  return mapCar(result.rows[0])
}

export async function listCarsByOwner(
  ownerId: string,
): Promise<(Car & { colorHex?: string })[]> {
  const result = await query('SELECT * FROM cars WHERE owner_id = $1', [
    ownerId,
  ])
  return result.rows.map(mapCar)
}

export async function updateCar(
  id: string,
  data: UpdateCarPayload,
): Promise<(Car & { colorHex?: string }) | null> {
  const result = await dynamicUpdate<Car & { colorHex?: string }>(
    'cars',
    id,
    data as unknown as Record<string, unknown>,
    ['photos'],
  )
  if (result && result.color) {
    result.colorHex = CAR_COLORS[result.color] || result.color
  }
  return result
}

export async function deleteCar(id: string): Promise<boolean> {
  const result = await query('DELETE FROM cars WHERE id = $1 RETURNING id', [
    id,
  ])
  return result.rowCount !== null && result.rowCount > 0
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

function hasImmutablePublishedRouteFieldUpdate(data: UpdateRoutePayload): boolean {
  return IMMUTABLE_PUBLISHED_ROUTE_FIELDS.some((field) => data[field] !== undefined)
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

export const listRoutesByDriver = listByColumn<Route>('routes', 'driver_id')

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
  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, id)
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

    await reserveRouteFeeTx(tx, route, feeRequiredVnd, {
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
  return dynamicUpdate<Plan>(
    'plans',
    id,
    data as unknown as Record<string, unknown>,
    ['pickup', 'dropoff'],
  )
}

export const listPlansByClient = listByColumn<Plan>('plans', 'client_id')

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

export async function deriveDemandGroups(): Promise<DemandGroupSummary[]> {
  const grouped = new Map<string, DemandGroupSummary>()

  const result = await query('SELECT * FROM plans WHERE status = $1', [
    'published',
  ])
  const activePlans = mapRows<Plan>(result.rows)

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
  SELECT 1 FROM search_requests WHERE route_id = $1 AND status = 'accepted'
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
  const resData = await withTransaction(async (tx) => {
    // Acquire a lock on the route so concurrent requests won't conflict
    const routeRes = await tx.query(
      'SELECT * FROM routes WHERE id = $1 FOR UPDATE',
      [routeId],
    )
    const route = mapRoute(routeRes.rows[0])
    if (!route) throw new HttpError(404, 'Route not found')

    if (!(await checkRouteAvailability(tx, routeId))) {
      throw new HttpError(
        409,
        'Route is not available — already has an accepted client',
      )
    }

    const group = await getDemandGroup(demandGroupId)
    if (!group) throw new HttpError(404, 'Demand group not found')

    const greqId = generateId('greq')

    const greqRes = await tx.query(
      `
      INSERT INTO group_requests (id, driver_id, route_id, demand_group_id, note, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `,
      [greqId, driverId, routeId, demandGroupId, note || '', 'pending'],
    )

    const greq = toCamelCase<GroupRequest>(greqRes.rows[0])
    if (!greq) throw new Error('Failed to create group request')
    const createdOffers: GroupOffer[] = []

    for (const tpId of group.memberPlanIds) {
      const tpRes = await tx.query('SELECT * FROM plans WHERE id = $1', [tpId])
      const tp = toCamelCase<Plan>(tpRes.rows[0])
      if (!tp) continue
      const offerId = generateId('goffer')

      const offerRes = await tx.query(
        `
        INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at)
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

      const offer = toCamelCase<GroupOffer>(offerRes.rows[0])
      if (offer) createdOffers.push(offer)
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
      throw new HttpError(
        409,
        `Cannot accept offer in status: ${offer.status}`,
      )
    }

    const route = await loadRouteForWalletTx(tx, offer.routeId)
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

    await chargeRouteFeeTx(tx, route, {
      description: 'Route fee charged on accepted group offer',
    })

    const siblingsRes = await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND id != $2 AND status = 'pending' RETURNING *",
      [offer.groupRequestId, offerId],
    )
    const siblings = mapRows<GroupOffer>(siblingsRes.rows)

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
  const result = await withTransaction(async (tx) => {
    const greqRes = await tx.query(
      'SELECT * FROM group_requests WHERE id = $1 FOR UPDATE',
      [requestId],
    )
    let greq = toCamelCase<GroupRequest>(greqRes.rows[0])
    if (!greq) throw new Error('Group request not found')
    if (greq.status !== 'pending') {
      throw new Error(`Cannot cancel request in status: ${greq.status}`)
    }

    const updatedRes = await tx.query(
      "UPDATE group_requests SET status = 'canceled' WHERE id = $1 RETURNING *",
      [requestId],
    )
    greq = toCamelCase<GroupRequest>(updatedRes.rows[0])
    if (!greq) throw new Error('Failed to cancel group request')

    const offersRes = await tx.query(
      "UPDATE group_offers SET status = 'closed' WHERE group_request_id = $1 AND status = 'pending' RETURNING *",
      [requestId],
    )
    const offers = mapRows<GroupOffer>(offersRes.rows)
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

export async function createSearchRequest(
  clientId: string,
  planId: string | null,
  routeId: string,
  note?: string,
): Promise<SearchRequest> {
  const resData = await withTransaction(async (tx) => {
    const existingRes = await tx.query(
      `SELECT * FROM search_requests WHERE client_id = $1 AND route_id = $2 AND status IN ('pending', 'accepted')`,
      [clientId, routeId],
    )
    if (existingRes.rows.length > 0) {
      const existingReq = toCamelCase<SearchRequest>(existingRes.rows[0])
      throw new HttpError<{ existingRequest: SearchRequest }>(
        409,
        'Duplicate active request already exists',
        { existingRequest: existingReq! },
      )
    }

    if (planId) {
      const tpRes = await tx.query('SELECT * FROM plans WHERE id = $1', [
        planId,
      ])
      const tp = toCamelCase<Plan>(tpRes.rows[0])
      if (!tp) {
        throw new HttpError(400, 'Plan not found')
      }
    }

    const routeRes = await tx.query(
      'SELECT * FROM routes WHERE id = $1 FOR UPDATE',
      [routeId],
    )
    const route = mapRoute(routeRes.rows[0])
    if (!route) throw new HttpError(404, 'Route not found')

    if (!(await checkRouteAvailability(tx, routeId))) {
      throw new HttpError(
        409,
        'Route is not available — already has an accepted client',
      )
    }

    const sreqId = generateId('sreq')

    try {
      const sreqRes = await tx.query(
        `
        INSERT INTO search_requests (id, client_id, plan_id, route_id, driver_id, trip_price, note, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `,
        [
          sreqId,
          clientId,
          planId || null,
          routeId,
          route.driverId,
          route.tripPrice,
          note || '',
          'pending',
        ],
      )

      return { sreq: toCamelCase<SearchRequest>(sreqRes.rows[0]), route }
    } catch (e: unknown) {
      if (isPgUniqueViolation(e, 'search_requests_active_client_route_idx')) {
        const raceRes = await tx.query(
          `SELECT * FROM search_requests WHERE client_id = $1 AND route_id = $2 AND status IN ('pending', 'accepted')`,
          [clientId, routeId],
        )
        const existingReqRace = toCamelCase<SearchRequest>(raceRes.rows[0])
        throw new HttpError<{ existingRequest: SearchRequest }>(
          409,
          'Duplicate active request already exists (race)',
          { existingRequest: existingReqRace! },
        )
      }
      throw e
    }
  })

  if (!resData.sreq) throw new Error('Failed to create search request')

  emitNotification('search_request_received', resData.route.driverId, {
    searchRequestId: resData.sreq.id,
    clientId,
    routeId,
  })

  return resData.sreq
}

export async function acceptSearchRequest(
  requestId: string,
): Promise<SearchRequest> {
  const sreq = await withTransaction(async (tx) => {
    const sreqRes = await tx.query(
      'SELECT * FROM search_requests WHERE id = $1 FOR UPDATE',
      [requestId],
    )
    let sreq = toCamelCase<SearchRequest>(sreqRes.rows[0])
    if (!sreq) throw new HttpError(404, 'Search request not found')
    if (sreq.status === 'accepted') {
      return sreq
    }
    if (sreq.status !== 'pending') {
      throw new HttpError(
        409,
        `Cannot accept search request in status: ${sreq.status}`,
      )
    }

    const route = await loadRouteForWalletTx(tx, sreq.routeId)
    if (route.status !== 'published') {
      throw new HttpError(
        409,
        `Cannot accept search request on route in status: ${route.status}`,
      )
    }

    if (!(await checkRouteAvailability(tx, sreq.routeId))) {
      throw new HttpError(
        409,
        'Route is no longer available — another client was accepted first',
      )
    }

    const updatedRes = await tx.query(
      "UPDATE search_requests SET status = 'accepted' WHERE id = $1 RETURNING *",
      [requestId],
    )
    sreq = toCamelCase<SearchRequest>(updatedRes.rows[0])
    if (!sreq) throw new Error('Failed to accept search request')

    await chargeRouteFeeTx(tx, route, {
      description: 'Route fee charged on accepted search request',
    })

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

type AcceptedJourneyMatch =
  | { kind: 'search_request'; request: SearchRequest }
  | { kind: 'group_offer'; offer: GroupOffer }

async function findAcceptedRouteMatchTx(
  executor: DbQueryExecutor,
  routeId: string,
): Promise<AcceptedJourneyMatch | null> {
  const searchRes = await executor.query(
    `
    SELECT *
    FROM search_requests
    WHERE route_id = $1 AND status = 'accepted'
    FOR UPDATE
  `,
    [routeId],
  )
  const acceptedSearch = mapRows<SearchRequest>(searchRes.rows)[0]
  if (acceptedSearch) {
    return { kind: 'search_request', request: acceptedSearch }
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
    FROM search_requests
    WHERE client_id = $1 AND plan_id = $2 AND status IN ('pending', 'accepted')
    FOR UPDATE
  `,
    [plan.clientId, plan.id],
  )
  const acceptedSearch = mapRows<SearchRequest>(searchRes.rows).find(
    (request) => request.status === 'accepted',
  )
  if (acceptedSearch) {
    return { kind: 'search_request', request: acceptedSearch }
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

async function cancelRouteTripTx(
  executor: DbQueryExecutor,
  route: Route,
): Promise<Route> {
  if (route.status === 'canceled') {
    return route
  }

  const accepted = await findAcceptedRouteMatchTx(executor, route.id)
  if (accepted) {
    if (route.walletFeeStatus === 'charged') {
      route = await refundRouteFeeTx(executor, route, {
        description: 'Route fee refunded on trip cancel',
      })
    } else if (route.walletFeeStatus === 'reserved') {
      route = await releaseRouteFeeTx(executor, route, {
        description: 'Route fee released on trip cancel',
      })
    } else if (
      route.walletFeeStatus !== 'refunded' &&
      route.walletFeeStatus !== 'released' &&
      route.walletFeeStatus !== 'none'
    ) {
      throw new HttpError(
        409,
        `Cannot cancel matched route in fee state: ${route.walletFeeStatus}`,
      )
    }

    if (accepted.kind === 'search_request') {
      await executor.query(
        "UPDATE search_requests SET status = 'canceled' WHERE id = $1",
        [accepted.request.id],
      )
    } else {
      await executor.query(
        "UPDATE group_offers SET status = 'canceled' WHERE id = $1",
        [accepted.offer.id],
      )
    }
  } else if (route.walletFeeStatus === 'reserved') {
    route = await releaseRouteFeeTx(executor, route, {
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
    const route = await loadRouteForWalletTx(executor, accepted.kind === 'search_request' ? accepted.request.routeId : accepted.offer.routeId)
    if (route.walletFeeStatus === 'charged') {
      await refundRouteFeeTx(executor, route, {
        description: 'Route fee refunded on trip cancel',
      })
    } else if (route.walletFeeStatus === 'reserved') {
      await releaseRouteFeeTx(executor, route, {
        description: 'Route fee released on trip cancel',
      })
    } else if (
      route.walletFeeStatus !== 'refunded' &&
      route.walletFeeStatus !== 'released' &&
      route.walletFeeStatus !== 'none'
    ) {
      throw new HttpError(
        409,
        `Cannot cancel matched route in fee state: ${route.walletFeeStatus}`,
      )
    }

    if (accepted.kind === 'search_request') {
      await executor.query(
        "UPDATE search_requests SET status = 'canceled' WHERE id = $1",
        [accepted.request.id],
      )
    } else {
      await executor.query(
        "UPDATE group_offers SET status = 'canceled' WHERE id = $1",
        [accepted.offer.id],
      )
    }
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
    const routeRes = await tx.query('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [
      tripId,
    ])
    if (routeRes.rows[0]) {
      const route = mapRoute(routeRes.rows[0])
      return cancelRouteTripTx(tx, route)
    }

    const planRes = await tx.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [
      tripId,
    ])
    const plan = toCamelCase<Plan>(planRes.rows[0])
    if (plan) {
      return cancelPlanTripTx(tx, plan)
    }

    throw new HttpError(404, 'Trip not found')
  })
}

export async function declineSearchRequest(
  requestId: string,
): Promise<SearchRequest> {
  const sreqRes = await query('SELECT * FROM search_requests WHERE id = $1', [
    requestId,
  ])
  const sreq = toCamelCase<SearchRequest>(sreqRes.rows[0])
  if (!sreq) throw new Error('Search request not found')
  if (sreq.status !== 'pending') {
    throw new Error(`Cannot decline search request in status: ${sreq.status}`)
  }
  const updatedRes = await query(
    "UPDATE search_requests SET status = 'declined' WHERE id = $1 RETURNING *",
    [requestId],
  )
  const updated = toCamelCase<SearchRequest>(updatedRes.rows[0])
  if (!updated) throw new Error('Failed to decline search request')

  emitNotification('search_request_declined', updated.clientId, {
    searchRequestId: requestId,
  })

  return updated
}

export const listGroupRequestsByDriver = listByColumn<GroupRequest>(
  'group_requests',
  'driver_id',
)
export const listGroupOffersByClient = listByColumn<GroupOffer>(
  'group_offers',
  'client_id',
)
export const listSearchRequestsByDriver = listByColumn<SearchRequest>(
  'search_requests',
  'driver_id',
)
export const listSearchRequestsByClient = listByColumn<SearchRequest>(
  'search_requests',
  'client_id',
)
export const listSearchRequestsByRoute = listByColumn<SearchRequest>(
  'search_requests',
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
