import {
  AppNotification,
  BootstrapSession,
  ClientRequestSource,
  GroupRequest,
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
  originWardId?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationProvinceId?: string
  departureWindowStartDate: string
  departureWindowEndDate: string
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
  originWardId?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationProvinceId?: string
  departureWindowStartDate?: string
  departureWindowEndDate?: string
  tripPrice?: number
  distanceMeters?: number
  notes?: string
  status?: string
}

export interface CreatePlanPayload {
  origin: Location
  destination: Location
  originWardId?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationProvinceId?: string
  departureWindowStartDate: string
  departureWindowEndDate: string
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
  originProvinceId?: string
  destinationWardId?: string
  destinationProvinceId?: string
  departureWindowStartDate?: string
  departureWindowEndDate?: string
  passengerCount?: number
  notes?: string
  status?: string
}

export interface SearchRoutesCriteriaPayload {
  clientId: string
  origin: Location
  destination: Location
  originWardId?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationProvinceId?: string
  departureWindowStartDate: string
  departureWindowEndDate: string
  passengerCount?: number
  notes?: string
}

export interface RouteLike {
  origin: Location
  destination: Location
  departureWindowStartDate: string
  departureWindowEndDate: string
  originWardId?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationProvinceId?: string
}

export interface PlanLike {
  origin: Location
  destination: Location
  departureWindowStartDate: string
  departureWindowEndDate: string
  originWardId?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationProvinceId?: string
}

export interface GeoCandidate {
  origin: Location
  destination: Location
  originWardId?: string
  originProvinceId?: string
  destinationWardId?: string
  destinationProvinceId?: string
}

// -- Matching Engine Results --
export interface ScoreFields {
  matchScore: number
  originFit: number
  destinationFit: number
  originDistanceKm: number
  destinationDistanceKm: number
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
  originWardId: string
  destinationWardId: string
  originWardName: string
  destinationWardName: string
  originProvinceId: string
  destinationProvinceId: string
  originProvinceName: string
  destinationProvinceName: string
  memberCount: number
  totalPassengerCount: number
  memberPlanIds?: string[]
  clientIds?: string[]
}

export interface MatchingRouteResult extends ScoreFields {
  routeId: string
  matchTier: string
  tripPrice: number
  departureWindowStartDate: string
  departureWindowEndDate: string
  origin: Location
  destination: Location
  driverSummary: DriverSummary | null
  carId: string
  routeAvailable: boolean
}

export interface DemandGroupSummary {
  id: string
  originWardId: string
  destinationWardId: string
  originProvinceId: string
  destinationProvinceId: string
  memberCount: number
  totalPassengerCount: number
  origin: Location
  destination: Location
  memberPlanIds: string[]
  clientIds: string[]
  visibilityMode?: string
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

// -- Hydrated request-list types --
export type Counterparty = Pick<
  User,
  | 'id'
  | 'displayName'
  | 'avatarUrl'
  | 'ratingAvg'
  | 'tripCount'
  | 'verificationStatus'
>

export interface SlimRoute {
  origin: Location
  destination: Location
  departureWindowStartDate: string
  departureWindowEndDate: string
}

export interface SlimPlan {
  passengerCount: number
  origin?: Location
  destination?: Location
}

export interface DemandGroupSummaryForRequest {
  memberCount: number
  totalPassengerCount: number
  earliestDeparture: string
  origin: Location | null
  destination: Location | null
}

// -- Client Inbox --
export type RequestDirection = 'incoming' | 'outgoing'

export interface ClientRequestItem {
  id: string
  source: ClientRequestSource
  direction: RequestDirection
  clientId: string
  routeId: string
  driverId: string
  planId: string | null
  tripPrice: number
  status: string
  note?: string
  createdAt: string
  expiresAt?: string
}

export interface HydratedClientRequestItem extends ClientRequestItem {
  counterparty: Counterparty | null
  route: SlimRoute | null
  plan: SlimPlan | null
}

export type SentGroupRequest = GroupRequest & { memberPlanIds: string[] }

export interface HydratedSentGroupRequest extends SentGroupRequest {
  route: SlimRoute | null
  demandGroup: DemandGroupSummaryForRequest | null
}

export interface HydratedRouteRequest extends RouteRequest {
  counterparty: Counterparty | null
  route: SlimRoute | null
  plan: SlimPlan | null
}

export interface HydratedClientGroupOffer {
  id: string
  groupRequestId: string
  routeId: string
  driverId: string
  clientId: string
  planId: string
  tripPrice: number
  status: string
  createdAt?: string
  counterparty: Counterparty | null
  route: SlimRoute | null
  plan: SlimPlan | null
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
