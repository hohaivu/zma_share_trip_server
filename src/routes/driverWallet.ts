import { Request, Response, Router } from 'express'

import { HttpError } from '../http-error'
import * as store from '../store'
import {
  ManualTopUpPayload,
  ManualTopUpResult,
  WalletSummary,
  WalletTransactionListPayload,
} from '../types/payloads'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

interface DriverWalletStoreApi {
  getDriverWalletSummary(driverId: string): Promise<WalletSummary>
  listDriverWalletTransactions(
    driverId: string,
    limit?: number,
  ): Promise<WalletTransactionListPayload['items']>
  topUpDriverWallet(
    driverId: string,
    payload: ManualTopUpPayload,
  ): Promise<ManualTopUpResult>
}

interface ManualTopUpRequestBody extends ManualTopUpPayload {
  driverId: string
}

const walletStore = store as unknown as DriverWalletStoreApi

const LOW_BALANCE_MESSAGE =
  'Wallet balance is too low to reserve this route fee. Top up and retry.'
const TOP_UP_RETRY_MESSAGE =
  'Top-up is already being processed. Retry with a different amount after it settles.'

function singleQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

function requireBodyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(
      400,
      `Wallet validation error: ${fieldName} is required`,
    )
  }
  return value
}

function parsePositiveInteger(
  value: string | undefined,
  fieldName: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new HttpError(
      400,
      `Wallet validation error: ${fieldName} must be a positive integer`,
    )
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(
      400,
      `Wallet validation error: ${fieldName} must be a positive integer`,
    )
  }

  return parsed
}

function normalizeWalletError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    const message = error.message.toLowerCase()
    if (error.statusCode === 409 && /duplicate|retry|already/i.test(message)) {
      return new HttpError(409, TOP_UP_RETRY_MESSAGE)
    }
    if (message.includes('balance') || message.includes('insufficient')) {
      return new HttpError(400, LOW_BALANCE_MESSAGE)
    }
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  if (lowered.includes('balance') || lowered.includes('insufficient')) {
    return new HttpError(400, LOW_BALANCE_MESSAGE)
  }
  if (lowered.includes('duplicate') || lowered.includes('retry')) {
    return new HttpError(409, TOP_UP_RETRY_MESSAGE)
  }

  return new HttpError(500, 'Internal server error')
}

// GET /api/driver/wallet?driverId=
router.get(
  '/wallet',
  asyncHandler(async (req: Request, res: Response) => {
    const driverId = singleQueryValue(req.query.driverId)
    requireParam(
      driverId,
      'Wallet validation error: driverId query is required',
    )

    res.json(await walletStore.getDriverWalletSummary(driverId))
  }),
)

// GET /api/driver/wallet/transactions?driverId=&limit=
router.get(
  '/wallet/transactions',
  asyncHandler(async (req: Request, res: Response) => {
    const driverId = singleQueryValue(req.query.driverId)
    requireParam(
      driverId,
      'Wallet validation error: driverId query is required',
    )

    const limit = parsePositiveInteger(
      singleQueryValue(req.query.limit),
      'limit',
    )

    const items = await walletStore.listDriverWalletTransactions(
      driverId,
      limit,
    )
    res.json({ items })
  }),
)

// POST /api/driver/wallet/topups
router.post(
  '/wallet/topups',
  asyncHandler(
    async (
      req: Request<Record<string, never>, unknown, ManualTopUpRequestBody>,
      res: Response,
    ) => {
      const { driverId, amountVnd, description } = req.body || {}
      const driverIdValue = requireBodyString(driverId, 'driverId')

      if (!Number.isInteger(amountVnd) || amountVnd <= 0) {
        throw new HttpError(
          400,
          'Wallet validation error: amountVnd must be a positive integer',
        )
      }

      if (description !== undefined && typeof description !== 'string') {
        throw new HttpError(
          400,
          'Wallet validation error: description must be a string',
        )
      }

      try {
        const result = await walletStore.topUpDriverWallet(driverIdValue, {
          amountVnd,
          description,
        })
        res.status(201).json(result)
      } catch (error) {
        throw normalizeWalletError(error)
      }
    },
  ),
)

export default router
