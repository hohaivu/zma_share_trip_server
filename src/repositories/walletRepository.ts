import { query, withTransaction } from '../db/connection'
import { parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { Route, Wallet, WalletTransaction } from '../types/entities'
import {
  ManualTopUpPayload,
  ManualTopUpResult,
  WalletSummary,
} from '../types/payloads'

const DEFAULT_WALLET_FEE_VND_PER_KM = 500
const DEFAULT_WALLET_TRANSACTION_LIMIT = 20

export type DbQueryExecutor = {
  query: (
    sql: string,
    params: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}

export type RouteMapper = (row: Record<string, unknown>) => Route

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

function getWalletFeeRateVndPerKm(): number {
  const raw = process.env.WALLET_FEE_VND_PER_KM
  const parsed = raw ? Number(raw) : DEFAULT_WALLET_FEE_VND_PER_KM
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WALLET_FEE_VND_PER_KM
  }
  return Math.floor(parsed)
}

export function mapWallet(row: Record<string, unknown>): Wallet {
  const wallet = toCamelCase<Wallet>(row)
  if (!wallet) throw new Error('Cannot map null row to Wallet')
  wallet.balanceVnd = parseNumeric(wallet.balanceVnd)
  wallet.reservedBalanceVnd = parseNumeric(wallet.reservedBalanceVnd)
  return wallet
}

export function mapWalletTransaction(row: Record<string, unknown>): WalletTransaction {
  const transaction = toCamelCase<WalletTransaction>(row)
  if (!transaction) throw new Error('Cannot map null row to WalletTransaction')
  transaction.amountVnd = parseNumeric(transaction.amountVnd)
  transaction.balanceAfterVnd = parseNumeric(transaction.balanceAfterVnd)
  transaction.reservedBalanceAfterVnd = parseNumeric(
    transaction.reservedBalanceAfterVnd,
  )
  return transaction
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

export function buildWalletSummary(wallet: Wallet): WalletSummary {
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

export async function getOrCreateDriverWalletTx(
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

export async function updateWalletRowTx(
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

export async function insertWalletTransactionTx(
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

export async function loadRouteForWalletTx(
  executor: DbQueryExecutor,
  routeId: string,
  mapRoute: RouteMapper,
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

export function computeRouteFeeRequiredVnd(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new HttpError(400, 'distanceMeters must be a positive integer')
  }
  if (!Number.isInteger(distanceMeters)) {
    throw new HttpError(400, 'distanceMeters must be a whole number')
  }

  return Math.ceil((distanceMeters / 1000) * getWalletFeeRateVndPerKm())
}

export async function reserveRouteFeeTx(
  executor: DbQueryExecutor,
  route: Route,
  feeRequiredVnd: number,
  mapRoute: RouteMapper,
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

export async function releaseRouteFeeTx(
  executor: DbQueryExecutor,
  route: Route,
  mapRoute: RouteMapper,
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

export async function chargeRouteFeeTx(
  executor: DbQueryExecutor,
  route: Route,
  mapRoute: RouteMapper,
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

export async function refundRouteFeeTx(
  executor: DbQueryExecutor,
  route: Route,
  mapRoute: RouteMapper,
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

export async function getOrCreateDriverWallet(driverId: string): Promise<Wallet> {
  return withTransaction((tx) => getOrCreateDriverWalletTx(tx, driverId))
}

export async function getDriverWalletSummary(driverId: string): Promise<WalletSummary> {
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

async function withOwnedRouteTx(
  routeId: string,
  driverId: string,
  mapRoute: RouteMapper,
  apply: (tx: DbQueryExecutor, route: Route) => Promise<Route>,
): Promise<Route> {
  return withTransaction(async (tx) => {
    const route = await loadRouteForWalletTx(tx, routeId, mapRoute)
    assertDriverOwnsRoute(route, driverId)
    return apply(tx, route)
  })
}

export async function reserveRouteFee(
  routeId: string,
  driverId: string,
  feeRequiredVnd: number,
  mapRoute: RouteMapper,
  meta?: { description?: string },
): Promise<Route> {
  return withOwnedRouteTx(routeId, driverId, mapRoute, (tx, route) =>
    reserveRouteFeeTx(tx, route, feeRequiredVnd, mapRoute, meta),
  )
}

export async function releaseRouteFee(
  routeId: string,
  driverId: string,
  mapRoute: RouteMapper,
  meta?: { description?: string },
): Promise<Route> {
  return withOwnedRouteTx(routeId, driverId, mapRoute, (tx, route) =>
    releaseRouteFeeTx(tx, route, mapRoute, meta),
  )
}

export async function chargeRouteFee(
  routeId: string,
  driverId: string,
  mapRoute: RouteMapper,
  meta?: { description?: string },
): Promise<Route> {
  return withOwnedRouteTx(routeId, driverId, mapRoute, (tx, route) =>
    chargeRouteFeeTx(tx, route, mapRoute, meta),
  )
}

export async function refundRouteFee(
  routeId: string,
  driverId: string,
  mapRoute: RouteMapper,
  meta?: { description?: string },
): Promise<Route> {
  return withOwnedRouteTx(routeId, driverId, mapRoute, (tx, route) =>
    refundRouteFeeTx(tx, route, mapRoute, meta),
  )
}
