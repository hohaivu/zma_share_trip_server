import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import {
  normalizeWalletError,
  parsePositiveInteger,
  requireBodyString,
} from '../shared/requestHelpers'
import { created, ok } from '../shared/responseEnvelope'
import * as walletService from '../services/walletService'
import { ManualTopUpPayload } from '../types/payloads'

interface ManualTopUpRequestBody extends ManualTopUpPayload {
  driverId: string
}

export async function getDriverWallet(req: Request, res: Response) {
  const { driverId } = req.body || {}
  const driverIdValue = requireBodyString(driverId, 'driverId')

  const summary = await walletService.getDriverWalletSummary(driverIdValue)
  res.json(ok(summary))
}

export async function listDriverWalletTransactions(
  req: Request,
  res: Response,
) {
  const { driverId, limit: limitInput } = req.body || {}
  const driverIdValue = requireBodyString(driverId, 'driverId')

  const limit = parsePositiveInteger(
    limitInput === undefined ? undefined : String(limitInput),
    'limit',
  )

  const items = await walletService.listDriverWalletTransactions(driverIdValue, limit)
  res.json(ok(items, { count: items.length }))
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
  const descriptionValue = description?.trim()

  try {
    const result = await walletService.topUpDriverWallet(driverIdValue, {
      amountVnd,
      description: descriptionValue,
    })
    res.status(201).json(created(result))
  } catch (error) {
    throw normalizeWalletError(error)
  }
}
