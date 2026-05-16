import * as store from '../store'

export const journeyRepository = {
  cancelTrip: store.cancelTrip,
  completeTrip: store.completeTrip,
  getReviewEligibility: store.getReviewEligibility,
  getRoute: store.getRoute,
  getPlan: store.getPlan,
  getUser: store.getUser,
  listRouteRequestsByRoute: store.listRouteRequestsByRoute,
  listRouteRequestsByPlan: store.listRouteRequestsByPlan,
  listGroupOffersByRoute: store.listGroupOffersByRoute,
  listGroupOffersByPlan: store.listGroupOffersByPlan,
  listSavedLocations: store.listSavedLocations,
  createSavedLocation: store.createSavedLocation,
  deleteSavedLocation: store.deleteSavedLocation,
}

export type JourneyRepository = typeof journeyRepository
