export interface Location {
  label?: string
  address?: string
  lat: number
  lng: number
  wardName?: string
  wardId?: string
  wardKey?: string
  districtName?: string
  districtId?: string
  provinceName?: string
  provinceId?: string
}

export interface User {
  id: string
  mauid: string
  displayName: string
  avatarUrl: string
  verificationStatus?: string
  ratingAvg?: number
  tripCount?: number
  blockedUserIds?: string[]
  preferredMode?: string
  modeSelectedAt?: string | Date
  role?: string
  createdAt?: Date | string
}

export interface Car {
  id: string
  ownerId: string
  plateNumberFull: string
  plateNumberMasked: string
  nickname?: string
  brand: string
  model: string
  color?: string | null
  seatCapacity?: number | null
  verificationStatus?: string
  photos?: unknown[]
  createdAt?: Date | string
}

export interface Route {
  id: string
  driverId: string
  carId: string
  origin: Location
  destination: Location
  originWardKey: string
  originWardId: string
  originProvinceId: string
  destinationWardKey: string
  destinationWardId: string
  destinationProvinceId: string
  waypoints?: Location[] | null
  serviceDate: string
  departureTime: string
  windowStart: string
  windowEnd: string
  tripPrice: number
  distanceMeters?: number | null
  feeRateVndPerKm?: number
  feeRequiredVnd?: number
  walletFeeStatus?: WalletFeeStatus
  walletReservedAt?: string | null
  walletChargedAt?: string | null
  walletReleasedAt?: string | null
  walletRefundedAt?: string | null
  emptySeats?: number
  status: string
  notes?: string | null
  createdAt?: string
}

export type WalletFeeStatus =
  | 'none'
  | 'reserved'
  | 'charged'
  | 'released'
  | 'refunded'

export type WalletTransactionType =
  | 'topup'
  | 'reservation'
  | 'release'
  | 'charge'
  | 'refund'

export interface Wallet {
  id: string
  driverId: string
  balanceVnd: number
  reservedBalanceVnd: number
  createdAt?: string
  updatedAt?: string
}

export interface WalletTransaction {
  id: string
  walletId: string
  driverId: string
  routeId?: string | null
  type: WalletTransactionType
  amountVnd: number
  balanceAfterVnd: number
  reservedBalanceAfterVnd: number
  description?: string | null
  metadata?: Record<string, unknown> | null
  createdAt?: string
}

export interface Plan {
  id: string
  clientId: string
  pickup: Location
  dropoff: Location
  pickupWardId: string
  pickupWardKey: string
  pickupProvinceId: string
  dropoffWardId: string
  dropoffWardKey: string
  dropoffProvinceId: string
  serviceDate: string
  departureBlockStart: string
  departureBlockEnd: string
  passengerCount: number
  notes?: string | null
  status: string
  createdAt?: string
}

export interface GroupRequest {
  id: string
  driverId: string
  routeId: string
  demandGroupId: string
  note?: string | null
  status: string
  createdAt?: string
}

export interface GroupOffer {
  id: string
  groupRequestId: string
  routeId: string
  driverId: string
  clientId: string
  planId: string
  tripPrice: number
  status: string
  createdAt?: string
}

export interface SearchRequest {
  id: string
  clientId: string
  planId?: string | null
  routeId: string
  driverId: string
  tripPrice?: number
  note?: string | null
  status: string
  createdAt?: string
}

export interface SavedLocation {
  id: string
  label: string
  lat: number
  lng: number
  createdAt?: string
}
