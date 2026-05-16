import * as walletRepository from '../repositories/walletRepository'
import { ManualTopUpPayload } from '../types/payloads'

export async function getDriverWalletSummary(driverId: string) {
  return walletRepository.getDriverWalletSummary(driverId)
}

export async function listDriverWalletTransactions(
  driverId: string,
  limit?: number,
) {
  return walletRepository.listDriverWalletTransactions(driverId, limit)
}

export async function topUpDriverWallet(
  driverId: string,
  payload: ManualTopUpPayload,
) {
  return walletRepository.topUpDriverWallet(driverId, payload)
}
