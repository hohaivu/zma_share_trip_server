import { Location, Plan, Route, SearchRequest, User } from './entities'

// -- Bootstrap --
export interface BootstrapPayload {
  mauid: string
  displayName: string
  avatarUrl: string
}

export interface BootstrapResult {
  user: User
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
  notes?: string
  status?: string
}

export interface CreatePlanPayload {
  pickup: Location
  dropoff: Location
  pickupWardId?: string
  pickupWardKey?: string
  pickupProvinceId?: string
  dropoffWardId?: string
  dropoffWardKey?: string
  dropoffProvinceId?: string
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
  pickup?: Location
  dropoff?: Location
  pickupWardId?: string
  pickupWardKey?: string
  pickupProvinceId?: string
  dropoffWardId?: string
  dropoffWardKey?: string
  dropoffProvinceId?: string
  serviceDate?: string
  departureBlockStart?: string
  departureBlockEnd?: string
  passengerCount?: number
  notes?: string
  status?: string
}

export interface SearchRoutesCriteriaPayload {
  clientId: string
  pickup: Location
  dropoff: Location
  pickupWardId?: string
  pickupWardKey?: string
  pickupProvinceId?: string
  dropoffWardId?: string
  dropoffWardKey?: string
  dropoffProvinceId?: string
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
  pickup: Location
  dropoff: Location
  serviceDate: string
  departureBlockStart: string
  departureBlockEnd: string
  pickupWardKey?: string
  dropoffWardKey?: string
}

// -- Matching Engine Results --
export interface ScoreFields {
  matchScore: number
  pickupFit: number
  dropoffFit: number
  timeFit: number
  detourEstimate: number
}

export interface DriverSummary {
  id: string
  displayName: string
  avatarUrl: string
  ratingAvg?: number
  tripCount?: number
}

export interface DemandGroupResult extends ScoreFields {
  demandGroupId: string
  matchTier: string
  visibilityMode: string
  tripPrice: number
  serviceDate: string
  pickupWardId: string
  dropoffWardId: string
  pickupWardName: string
  dropoffWardName: string
  pickupWardKey: string
  dropoffWardKey: string
  pickupProvinceId: string
  dropoffProvinceId: string
  departureBlockStart: string
  departureBlockEnd: string
  memberCount: number
  totalPassengerCount: number
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
  pickupWardId: string
  dropoffWardId: string
  pickupWardKey: string
  dropoffWardKey: string
  pickupProvinceId: string
  dropoffProvinceId: string
  departureBlockStart: string
  departureBlockEnd: string
  memberCount: number
  totalPassengerCount: number
  pickup: Location
  dropoff: Location
  memberPlanIds: string[]
  clientIds: string[]
}

// -- Shared Journey Summary --
export interface AcceptedSearchRequestSummary {
  type: 'search_request'
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
  | AcceptedSearchRequestSummary
  | AcceptedGroupOfferSummary

export type JourneySummary = (Route | Plan) & {
  accepted: JourneyAcceptedState | null
}

// -- Conflicts --
export interface DuplicateRequestConflict {
  existingRequest: SearchRequest
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
