import { query, withTransaction } from '../db/connection'
import { parseNumeric, toCamelCase } from '../db/utils'
import { HttpError } from '../http-error'
import { Route, Wallet, WalletTransaction } from '../types/entities'

const DEFAULT_WALLET_FEE_VND_PER_KM = 500

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

/**
 * Resolves the per-km wallet fee from environment configuration. Lives in the
 * repository because the *Tx route-fee primitives (called from cross-repo
 * transactional flows in driverRouteRepository, journeyRepository, etc.) need
 * it to persist the fee rate snapshot at reservation time.
 */
export function getWalletFeeRateVndPerKm(): number {
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

export async function getOrCreateDriverWalletTx(
  executor: DbQueryExecutor,
  driverId: string,
): Promise<Wallet> {
  const existing = await executor.query(
    'SELECT * FROM wallets WHERE driver_id = ? FOR UPDATE',
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
      VALUES (?, ?, 0, 0, NOW(), NOW())
      RETURNING *
    `,
      [generateId('wallet'), driverId],
    )
    return mapWallet(inserted.rows[0])
  } catch (error) {
    if ((error as Record<string, unknown>)?.errno === 1062) {
      const retry = await executor.query(
        'SELECT * FROM wallets WHERE driver_id = ? FOR UPDATE',
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
  await executor.query(
    `
    UPDATE wallets
    SET balance_vnd = COALESCE(?, balance_vnd),
        reserved_balance_vnd = COALESCE(?, reserved_balance_vnd),
        updated_at = NOW()
    WHERE id = ?
  `,
    [data.balanceVnd ?? null, data.reservedBalanceVnd ?? null, walletId],
  )
  const updated = await executor.query(
    'SELECT * FROM wallets WHERE id = ?',
    [walletId],
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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

/**
 * Loads the route row inside a transaction with FOR UPDATE locking.
 *
 * NOTE: Throws HttpError(404) when the row is missing because every current
 * caller (cross-repository fee composition) expects an exception in that case.
 * The state-machine guards below also remain co-located with the *Tx
 * persistence primitives for the same reason — these primitives are composed
 * inside other repositories' withTransaction() blocks. The user-facing
 * walletService surface does not depend on these guards directly.
 */
export async function loadRouteForWalletTx(
  executor: DbQueryExecutor,
  routeId: string,
  mapRoute: RouteMapper,
): Promise<Route> {
  const result = await executor.query(
    'SELECT * FROM routes WHERE id = ? FOR UPDATE',
    [routeId],
  )
  const route = mapRoute(result.rows[0])
  if (!route) throw new HttpError(404, 'Route not found')
  return route
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
  const availableBalanceVnd = wallet.balanceVnd - wallet.reservedBalanceVnd
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
  await executor.query(
    `
    UPDATE routes
    SET fee_rate_vnd_per_km = ?,
        fee_required_vnd = ?,
        wallet_fee_status = 'reserved',
        wallet_reserved_at = NOW()
    WHERE id = ?
  `,
    [feeRateVndPerKm, feeRequiredVnd, route.id],
  )
  const updatedRouteRes = await executor.query(
    'SELECT * FROM routes WHERE id = ?',
    [route.id],
  )
  return mapRoute(updatedRouteRes.rows[0])
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

  await executor.query(
    `
    UPDATE routes
    SET wallet_fee_status = 'released',
        wallet_released_at = NOW()
    WHERE id = ?
  `,
    [route.id],
  )
  const updatedRouteRes = await executor.query(
    'SELECT * FROM routes WHERE id = ?',
    [route.id],
  )
  return mapRoute(updatedRouteRes.rows[0])
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

  await executor.query(
    `
    UPDATE routes
    SET wallet_fee_status = 'charged',
        wallet_charged_at = NOW()
    WHERE id = ?
  `,
    [route.id],
  )
  const updatedRouteRes = await executor.query(
    'SELECT * FROM routes WHERE id = ?',
    [route.id],
  )
  return mapRoute(updatedRouteRes.rows[0])
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

  await executor.query(
    `
    UPDATE routes
    SET wallet_fee_status = 'refunded',
        wallet_refunded_at = NOW()
    WHERE id = ?
  `,
    [route.id],
  )
  const updatedRouteRes = await executor.query(
    'SELECT * FROM routes WHERE id = ?',
    [route.id],
  )
  return mapRoute(updatedRouteRes.rows[0])
}

export async function getOrCreateDriverWallet(driverId: string): Promise<Wallet> {
  return withTransaction((tx) => getOrCreateDriverWalletTx(tx, driverId))
}

/**
 * Raw wallet-transaction lookup. Service layer is responsible for clamping
 * the limit and any other business-policy rules.
 */
export async function findDriverWalletTransactions(
  driverId: string,
  limit: number,
): Promise<WalletTransaction[]> {
  const result = await query(
    `
    SELECT *
    FROM wallet_transactions
    WHERE driver_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `,
    [driverId, limit],
  )
  return result.rows.map(mapWalletTransaction)
}

/**
 * Atomic manual top-up persistence primitive. Performs no input validation —
 * callers (walletService) are expected to validate the amount and translate
 * any business-level errors into HttpErrors before calling this function.
 */
export async function applyManualTopUp(
  driverId: string,
  amountVnd: number,
  description: string | undefined,
): Promise<{ wallet: Wallet; transaction: WalletTransaction }> {
  return withTransaction(async (tx) => {
    const wallet = await getOrCreateDriverWalletTx(tx, driverId)
    const updatedWallet = await updateWalletRowTx(tx, wallet.id, {
      balanceVnd: wallet.balanceVnd + amountVnd,
    })
    const transaction = await insertWalletTransactionTx(tx, {
      walletId: wallet.id,
      driverId,
      type: 'topup',
      amountVnd,
      balanceAfterVnd: updatedWallet.balanceVnd,
      reservedBalanceAfterVnd: updatedWallet.reservedBalanceVnd,
      description: description || 'Manual top-up',
      metadata: {
        source: 'manual_top_up',
      },
    })
    return { wallet: updatedWallet, transaction }
  })
}
