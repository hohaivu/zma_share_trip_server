import * as carServiceImpl from './carService'
import * as driverRouteServiceImpl from './driverRouteService'
import { groupOfferService as mvcGroupOfferService } from './groupOfferService'
import * as demandGroupRepository from '../repositories/demandGroupRepository'
import { journeyRepository } from '../repositories/journeyRepository'
import { journeyService as mvcJourneyService } from './journeyService'
import * as planServiceImpl from './planService'
import * as userServiceImpl from './userService'
import * as walletServiceImpl from './walletService'
import { routeRequestService as routeRequestDomainService } from './routeRequestService'
import { groupRequestService as mvcGroupRequestService } from './groupRequestService'

export interface RouteService {
  createRoute: typeof driverRouteServiceImpl.createRoute
  listRoutesByDriver: typeof driverRouteServiceImpl.listRoutesByDriver
  getRoute: typeof driverRouteServiceImpl.getRoute
  publishRoute: typeof driverRouteServiceImpl.publishRoute
  updateRoute: typeof driverRouteServiceImpl.updateRoute
}

export interface PlanService {
  createPlan: typeof planServiceImpl.createPlan
  listPlansByClient: typeof planServiceImpl.listPlansByClient
  getPlan: typeof planServiceImpl.getPlan
  updatePlan: typeof planServiceImpl.updatePlan
  cancelPlanByClient: typeof planServiceImpl.cancelPlanByClient
}

export interface DemandGroupService {
  getDemandGroup: typeof demandGroupRepository.getDemandGroup
  getDemandGroupMembers: typeof demandGroupRepository.getDemandGroupMembers
}

export interface GroupOfferService {
  listGroupOffersByClient: typeof mvcGroupOfferService.listGroupOffersByClient
  acceptGroupOffer: typeof mvcGroupOfferService.acceptGroupOffer
  declineGroupOffer: typeof mvcGroupOfferService.declineGroupOffer
}

export interface GroupRequestService {
  createGroupRequest: typeof mvcGroupRequestService.createGroupRequest
  listGroupRequestsByDriver: typeof mvcGroupRequestService.listGroupRequestsByDriver
  cancelGroupRequest: typeof mvcGroupRequestService.cancelGroupRequest
}

export interface UserService {
  getUser: typeof userServiceImpl.getUser
  updateUser: typeof userServiceImpl.updateUser
  setUserMode: typeof userServiceImpl.setUserMode
  getUserMode: typeof userServiceImpl.getUserMode
  listReviewsByReviewer: typeof userServiceImpl.listReviewsByReviewer
  createReview: typeof userServiceImpl.createReview
  createReport: typeof userServiceImpl.createReport
  listReportsByReporter: typeof userServiceImpl.listReportsByReporter
  getBlockedUsers: typeof userServiceImpl.getBlockedUsers
  blockUser: typeof userServiceImpl.blockUser
  unblockUser: typeof userServiceImpl.unblockUser
  listNotifications: typeof userServiceImpl.listNotifications
  createNotification: typeof userServiceImpl.createNotification
  markNotificationRead: typeof userServiceImpl.markNotificationRead
  markAllNotificationsRead: typeof userServiceImpl.markAllNotificationsRead
}

export interface RouteRequestService {
  createRouteRequest: typeof routeRequestDomainService.createRouteRequest
  listRouteRequestsByClient: typeof routeRequestDomainService.listRouteRequestsByClient
  cancelRouteRequest: typeof routeRequestDomainService.cancelRouteRequest
  listRouteRequestsByDriver: typeof routeRequestDomainService.listRouteRequestsByDriver
  acceptRouteRequest: typeof routeRequestDomainService.acceptRouteRequest
  declineRouteRequest: typeof routeRequestDomainService.declineRouteRequest
}

export interface CarService {
  createCar: typeof carServiceImpl.createCar
  listCarsByOwner: typeof carServiceImpl.listCarsByOwner
  getCarById: typeof carServiceImpl.getCarById
  updateCar: typeof carServiceImpl.updateCar
  deleteCar: typeof carServiceImpl.deleteCar
}

export interface JourneyService {
  cancelTrip: typeof journeyRepository.cancelTrip
  completeTrip: typeof journeyRepository.completeTrip
  getReviewEligibility: typeof journeyRepository.getReviewEligibility
  getRoute: typeof journeyRepository.getRoute
  getPlan: typeof journeyRepository.getPlan
  getUser: typeof journeyRepository.getUser
  listRouteRequestsByRoute: typeof journeyRepository.listRouteRequestsByRoute
  listRouteRequestsByPlan: typeof journeyRepository.listRouteRequestsByPlan
  listGroupOffersByRoute: typeof journeyRepository.listGroupOffersByRoute
  listGroupOffersByPlan: typeof journeyRepository.listGroupOffersByPlan
  listSavedLocations: typeof journeyRepository.listSavedLocations
  createSavedLocation: typeof journeyRepository.createSavedLocation
  deleteSavedLocation: typeof journeyRepository.deleteSavedLocation
}

export interface WalletService {
  getDriverWalletSummary: typeof walletServiceImpl.getDriverWalletSummary
  listDriverWalletTransactions: typeof walletServiceImpl.listDriverWalletTransactions
  topUpDriverWallet: typeof walletServiceImpl.topUpDriverWallet
}

export const routeService: RouteService = driverRouteServiceImpl
export const planService: PlanService = planServiceImpl
export const demandGroupService: DemandGroupService = demandGroupRepository
export const groupOfferService: GroupOfferService = mvcGroupOfferService
export const groupRequestService: GroupRequestService = mvcGroupRequestService
export const userService: UserService = userServiceImpl
export const routeRequestService: RouteRequestService = routeRequestDomainService
export const carService: CarService = carServiceImpl
export const journeyService: JourneyService = {
  ...journeyRepository,
  ...mvcJourneyService,
}
export const walletService: WalletService = walletServiceImpl
