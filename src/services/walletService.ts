import { HttpError } from '../http-error'
import * as walletRepository from '../repositories/walletRepository'
import { Wallet } from '../types/entities'
import {
  ManualTopUpPayload,
  ManualTopUpResult,
  WalletSummary,
} from '../types/payloads'

const DEFAULT_WALLET_TRANSACTION_LIMIT = 20
const MAX_WALLET_TRANSACTION_LIMIT = 100

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
  const feeRateVndPerKm = walletRepository.getWalletFeeRateVndPerKm()
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

export function computeRouteFeeRequiredVnd(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new HttpError(400, 'distanceMeters must be a positive integer')
  }
  if (!Number.isInteger(distanceMeters)) {
    throw new HttpError(400, 'distanceMeters must be a whole number')
  }

  return Math.ceil(
    (distanceMeters / 1000) * walletRepository.getWalletFeeRateVndPerKm(),
  )
}

export async function getDriverWalletSummary(
  driverId: string,
): Promise<WalletSummary> {
  const wallet = await walletRepository.getOrCreateDriverWallet(driverId)
  return buildWalletSummary(wallet)
}

export async function listDriverWalletTransactions(
  driverId: string,
  limit?: number,
) {
  const txLimit = Math.max(
    1,
    Math.min(
      MAX_WALLET_TRANSACTION_LIMIT,
      Math.floor(limit ?? DEFAULT_WALLET_TRANSACTION_LIMIT),
    ),
  )
  return walletRepository.findDriverWalletTransactions(driverId, txLimit)
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

  const { wallet, transaction } = await walletRepository.applyManualTopUp(
    driverId,
    payload.amountVnd,
    payload.description,
  )

  return {
    summary: buildWalletSummary(wallet),
    transaction,
  }
}
