import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import {
  normalizeWalletError,
  parsePositiveInteger,
  requireBodyString,
  singleQueryValue,
} from '../shared/requestHelpers'
import * as walletService from '../services/walletService'
import { ManualTopUpPayload } from '../types/payloads'
import { requireParam } from '../routes/helpers'

interface ManualTopUpRequestBody extends ManualTopUpPayload {
  driverId: string
}

export async function getDriverWallet(req: Request, res: Response) {
  const driverId = singleQueryValue(req.query.driverId)
  requireParam(driverId, 'Wallet validation error: driverId query is required')

  res.json(await walletService.getDriverWalletSummary(driverId))
}

export async function listDriverWalletTransactions(
  req: Request,
  res: Response,
) {
  const driverId = singleQueryValue(req.query.driverId)
  requireParam(driverId, 'Wallet validation error: driverId query is required')

  const limit = parsePositiveInteger(singleQueryValue(req.query.limit), 'limit')

  const items = await walletService.listDriverWalletTransactions(driverId, limit)
  res.json({ items })
}

export async function topUpDriverWallet(
  req: Request<Record<string, never>, unknown, ManualTopUpRequestBody>,
  res: Response,
) {
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
}
