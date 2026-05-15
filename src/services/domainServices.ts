import * as store from '../store'

type StoreMethod<Name extends keyof typeof store> = (typeof store)[Name]

export interface RouteService {
  createRoute: StoreMethod<'createRoute'>
  listRoutesByDriver: StoreMethod<'listRoutesByDriver'>
  getRoute: StoreMethod<'getRoute'>
  publishRoute: StoreMethod<'publishRoute'>
  updateRoute: StoreMethod<'updateRoute'>
}

export interface PlanService {
  createPlan: StoreMethod<'createPlan'>
  listPlansByClient: StoreMethod<'listPlansByClient'>
  getPlan: StoreMethod<'getPlan'>
  updatePlan: StoreMethod<'updatePlan'>
  cancelPlanByClient: StoreMethod<'cancelPlanByClient'>
}

export interface DemandGroupService {
  getDemandGroup: StoreMethod<'getDemandGroup'>
  getDemandGroupMembers: StoreMethod<'getDemandGroupMembers'>
}

export interface GroupOfferService {
  listGroupOffersByClient: StoreMethod<'listGroupOffersByClient'>
  acceptGroupOffer: StoreMethod<'acceptGroupOffer'>
  declineGroupOffer: StoreMethod<'declineGroupOffer'>
}

export interface GroupRequestService {
  createGroupRequest: StoreMethod<'createGroupRequest'>
  listGroupRequestsByDriver: StoreMethod<'listGroupRequestsByDriver'>
  cancelGroupRequest: StoreMethod<'cancelGroupRequest'>
}

export interface JourneyService {
  cancelTrip: StoreMethod<'cancelTrip'>
  completeTrip: StoreMethod<'completeTrip'>
  getReviewEligibility: StoreMethod<'getReviewEligibility'>
  getRoute: StoreMethod<'getRoute'>
  getPlan: StoreMethod<'getPlan'>
  getUser: StoreMethod<'getUser'>
  listRouteRequestsByRoute: StoreMethod<'listRouteRequestsByRoute'>
  listRouteRequestsByPlan: StoreMethod<'listRouteRequestsByPlan'>
  listGroupOffersByRoute: StoreMethod<'listGroupOffersByRoute'>
  listGroupOffersByPlan: StoreMethod<'listGroupOffersByPlan'>
  listSavedLocations: StoreMethod<'listSavedLocations'>
  createSavedLocation: StoreMethod<'createSavedLocation'>
  deleteSavedLocation: StoreMethod<'deleteSavedLocation'>
}

export interface WalletService {
  getDriverWalletSummary: StoreMethod<'getDriverWalletSummary'>
  listDriverWalletTransactions: StoreMethod<'listDriverWalletTransactions'>
  topUpDriverWallet: StoreMethod<'topUpDriverWallet'>
}

export const routeService: RouteService = store
export const planService: PlanService = store
export const demandGroupService: DemandGroupService = store
export const groupOfferService: GroupOfferService = store
export const groupRequestService: GroupRequestService = store
export const journeyService: JourneyService = store
export const walletService: WalletService = store
