import * as store from '../store'
import * as carServiceImpl from './carService'
import * as userServiceImpl from './userService'
import * as walletServiceImpl from './walletService'
import { routeRequestService as routeRequestDomainService } from './routeRequestService'
import { groupRequestService as mvcGroupRequestService } from './groupRequestService'

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

export interface UserService {
  getUser: StoreMethod<'getUser'>
  updateUser: StoreMethod<'updateUser'>
  setUserMode: StoreMethod<'setUserMode'>
  getUserMode: StoreMethod<'getUserMode'>
  listReviewsByReviewer: StoreMethod<'listReviewsByReviewer'>
  createReview: StoreMethod<'createReview'>
  createReport: StoreMethod<'createReport'>
  listReportsByReporter: StoreMethod<'listReportsByReporter'>
  getBlockedUsers: StoreMethod<'getBlockedUsers'>
  blockUser: StoreMethod<'blockUser'>
  unblockUser: StoreMethod<'unblockUser'>
  listNotifications: StoreMethod<'listNotifications'>
  createNotification: StoreMethod<'createNotification'>
  markNotificationRead: StoreMethod<'markNotificationRead'>
  markAllNotificationsRead: StoreMethod<'markAllNotificationsRead'>
}

export interface RouteRequestService {
  createRouteRequest: StoreMethod<'createRouteRequest'>
  listRouteRequestsByClient: StoreMethod<'listRouteRequestsByClient'>
  cancelRouteRequest: StoreMethod<'cancelRouteRequest'>
  listRouteRequestsByDriver: StoreMethod<'listRouteRequestsByDriver'>
  acceptRouteRequest: StoreMethod<'acceptRouteRequest'>
  declineRouteRequest: StoreMethod<'declineRouteRequest'>
}

export interface CarService {
  createCar: typeof carServiceImpl.createCar
  listCarsByOwner: typeof carServiceImpl.listCarsByOwner
  getCarById: typeof carServiceImpl.getCarById
  updateCar: typeof carServiceImpl.updateCar
  deleteCar: typeof carServiceImpl.deleteCar
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
export const groupRequestService: GroupRequestService = mvcGroupRequestService
export const userService: UserService = {
  ...store,
  getUser: userServiceImpl.getUser,
  updateUser: userServiceImpl.updateUser,
  setUserMode: userServiceImpl.setUserMode,
  getUserMode: userServiceImpl.getUserMode,
}
export const routeRequestService: RouteRequestService = routeRequestDomainService
export const carService: CarService = carServiceImpl
export const journeyService: JourneyService = store
export const walletService: WalletService = walletServiceImpl
