import {
  AppNotification,
  BootstrapSession,
  ClientRequestSource,
  Location,
  Plan,
  Report,
  Review,
  Route,
  RouteRequest,
  User,
  Wallet,
  WalletFeeStatus,
  WalletTransaction,
} from './entities'

// -- Bootstrap --
export interface BootstrapPayload {
  mauid: string
  displayName: string
  avatarUrl: string
}

export interface BootstrapResult {
  session: BootstrapSession
  wasCreated: boolean
}

// -- Route & Plan Creation --
export interface CreateRoutePayload {
  carId: string
  origin: Location
  destination: Location
  originWardKey?: string
  originWardId?: string
  originProvinceId?: string
  destinationWardKey?: string
  destinationWardId?: string
  destinationProvinceId?: string
  serviceDate: string
  departureTime: string
  windowStart?: string
  windowEnd?: string
  tripPrice: number
  distanceMeters?: number
  notes?: string
  status?: string
}

export interface CreateRouteRequestBody extends CreateRoutePayload {
  driverId: string
}

export interface UpdateRoutePayload {
  carId?: string
  origin?: Location
  destination?: Location
  originWardKey?: string
  originWardId?: string
  originProvinceId?: string
  destinationWardKey?: string
  destinationWardId?: string
  destinationProvinceId?: string
  serviceDate?: string
  departureTime?: string
  windowStart?: string
  windowEnd?: string
  tripPrice?: number
  distanceMeters?: number
  notes?: string
  status?: string
}

export interface CreatePlanPayload {
  origin: Location
  destination: Location
  originWardId?: string
  originWardKey?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationWardKey?: string
  destinationProvinceId?: string
  serviceDate: string
  departureBlockStart: string
  departureBlockEnd: string
  passengerCount: number
  notes?: string
  status?: string
}

export interface CreatePlanRequestBody extends CreatePlanPayload {
  clientId: string
}

export interface UpdatePlanPayload {
  origin?: Location
  destination?: Location
  originWardId?: string
  originWardKey?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationWardKey?: string
  destinationProvinceId?: string
  serviceDate?: string
  departureBlockStart?: string
  departureBlockEnd?: string
  passengerCount?: number
  notes?: string
  status?: string
}

export interface SearchRoutesCriteriaPayload {
  clientId: string
  origin: Location
  destination: Location
  originWardId?: string
  originWardKey?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationWardKey?: string
  destinationProvinceId?: string
  serviceDate: string
  departureBlockStart: string
  departureBlockEnd: string
  passengerCount?: number
  notes?: string
}

export interface RouteLike {
  origin: Location
  destination: Location
  serviceDate: string
  departureTime: string
  originWardKey?: string
  destinationWardKey?: string
}

export interface PlanLike {
  origin: Location
  destination: Location
  serviceDate: string
  departureBlockStart: string
  departureBlockEnd: string
  originWardKey?: string
  destinationWardKey?: string
}

// -- Matching Engine Results --
export interface ScoreFields {
  matchScore: number
  originFit: number
  destinationFit: number
  timeFit: number
  detourEstimate: number
}

export interface DriverSummary {
  id: string
  mauid?: string
  displayName: string
  avatarUrl: string
  verificationStatus?: string
  ratingAvg?: number
  tripCount?: number
}

export interface DemandGroupResult extends ScoreFields {
  demandGroupId: string
  matchTier: string
  visibilityMode: string
  tripPrice: number
  serviceDate: string
  originWardId: string
  destinationWardId: string
  originWardName: string
  destinationWardName: string
  originWardKey: string
  destinationWardKey: string
  originProvinceId: string
  destinationProvinceId: string
  departureBlockStart: string
  departureBlockEnd: string
  memberCount: number
  totalPassengerCount: number
  memberPlanIds?: string[]
}

export interface MatchingRouteResult extends ScoreFields {
  routeId: string
  matchTier: string
  tripPrice: number
  serviceDate: string
  departureTime: string
  origin: Location
  destination: Location
  driverSummary: DriverSummary | null
  carId: string
  routeAvailable: boolean
}

export interface DemandGroupSummary {
  id: string
  serviceDate: string
  originWardId: string
  destinationWardId: string
  originWardKey: string
  destinationWardKey: string
  originProvinceId: string
  destinationProvinceId: string
  departureBlockStart: string
  departureBlockEnd: string
  memberCount: number
  totalPassengerCount: number
  origin: Location
  destination: Location
  memberPlanIds: string[]
  clientIds: string[]
}

// -- Shared Journey Summary --
export interface AcceptedRouteRequestSummary {
  type: 'route_request'
  requestId: string
  tripPrice: number
  status: string
  matchedUser: User | null
  plan: Plan | null
}

export interface AcceptedGroupOfferSummary {
  type: 'group_offer'
  offerId: string
  tripPrice: number
  status: string
  matchedUser: User | null
  route: Route | null
}

export type JourneyAcceptedState =
  | AcceptedRouteRequestSummary
  | AcceptedGroupOfferSummary

export type ReviewEligibilityReason =
  | 'eligible'
  | 'not_completed'
  | 'missing_completed_at'
  | 'outside_window'
  | 'already_submitted'
  | 'missing_counterpart'
  | 'not_participant'

export interface ReviewEligibility {
  canSubmit: boolean
  hasSubmitted: boolean
  reason: ReviewEligibilityReason
  windowClosesAt: string | null
  revieweeId: string | null
}

export type WithReviewEligibility<T> = T & {
  reviewEligibility?: ReviewEligibility
}

export type JourneySummary = (Route | Plan) & {
  accepted: JourneyAcceptedState | null
  reviewEligibility?: ReviewEligibility
}

export interface WalletSummary extends Wallet {
  availableBalanceVnd: number
  feeRateVndPerKm: number
  maxPublishableDistanceMeters: number
}

export interface WalletTransactionListPayload {
  items: WalletTransaction[]
}

export interface ManualTopUpPayload {
  amountVnd: number
  description?: string
}

export interface ManualTopUpResult {
  summary: WalletSummary
  transaction: WalletTransaction
}

export interface UpdateUserPayload {
  displayName?: string
  avatarUrl?: string
  phone?: string | null
  preferredMode?: string | null
}

export interface CreateReviewPayload {
  tripId: string
  reviewerId: string
  revieweeId: string
  rating: number
  comment?: string
}

export interface CreateReportPayload {
  tripId: string
  reporterId: string
  reporteeId: string
  reason: string
  detail?: string
}

export interface CreateNotificationPayload {
  recipientId: string
  type: AppNotification['type']
  title: string
  body: string
  targetRoute?: string
  deepLink?: string
  requestSource?: ClientRequestSource
  metadata?: Record<string, unknown>
}

export interface RouteFeeSnapshot {
  distanceMeters: number | null
  feeRateVndPerKm: number
  feeRequiredVnd: number
  walletFeeStatus: WalletFeeStatus
  walletReservedAt?: string | null
  walletChargedAt?: string | null
  walletReleasedAt?: string | null
  walletRefundedAt?: string | null
}

// -- Conflicts --
export interface DuplicateRequestConflict {
  existingRequest: RouteRequest
}

// -- Car Payloads --
export interface CreateCarPayload {
  nickname?: string
  plateNumberMasked?: string
  plateNumberFull: string
  brand: string
  model: string
  color?: string
  seatCapacity?: number
  verificationStatus?: string
  photos?: unknown[]
}

export interface UpdateCarPayload {
  nickname?: string
  plateNumberMasked?: string
  plateNumberFull?: string
  brand?: string
  model?: string
  color?: string
  seatCapacity?: number
  verificationStatus?: string
  photos?: unknown[]
}
