import { Request, Response, Router } from 'express'

import {
  normalizeWalletError,
  parsePositiveInteger,
  requireBodyString,
  singleQueryValue,
} from '../shared/requestHelpers'
import { HttpError } from '../http-error'
import { walletService } from '../services/domainServices'
import { ManualTopUpPayload } from '../types/payloads'
import { asyncHandler, requireParam } from './helpers'

const router = Router()

interface ManualTopUpRequestBody extends ManualTopUpPayload {
  driverId: string
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

    res.json(await walletService.getDriverWalletSummary(driverId))
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

    const items = await walletService.listDriverWalletTransactions(
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
        const result = await walletService.topUpDriverWallet(driverIdValue, {
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
