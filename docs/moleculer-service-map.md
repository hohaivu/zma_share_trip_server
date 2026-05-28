# Moleculer Service Map (Preparation Draft)

This document is a preparation-only map for a future MoleculerJS strangler migration.
It does **not** introduce a Moleculer runtime dependency, change public API behavior, or split the database.
The goal is to define stable service boundaries, action contracts, dependencies, and a low-risk migration order before any framework move.

## Mapping principles

- Keep the current Express route/controller/service/repository stack stable while preparing service contracts.
- Model future Moleculer services around the current `src/services/*` modules first.
- Prefer plain serializable action inputs/outputs so the same contract can work behind Express today and Moleculer later.
- Treat cross-domain calls as explicit contracts: same-domain helpers, synchronous actions, or asynchronous events.
- Keep persistence ownership with the current repositories until a service is actually extracted behind the contract.

## Proposed service map

| Future service | Current module(s) | Owned actions | Owned repositories / tables | Dependencies | Likely emitted events |
|---|---|---|---|---|---|
| `users` | `src/services/userService.ts` | `bootstrapUser`, `getUser`, `assertUserRole`, `updateUser`, `setUserMode`, `getUserMode`, `setModeForUser`, `getModeForUser`, `getBlockedUsers`, `blockUser`, `unblockUser` | `userRepository` → users, identities, user modes, block relations | Same-domain: review/report/notification helper methods currently exposed by `userService`; sync actions to wallets and notifications when needed | `user.created`, `user.updated`, `user.mode.changed`, `user.blocked`, `user.unblocked` |
| `wallets` | `src/services/walletService.ts` | `computeAvailableBalanceVnd`, `buildWalletSummary`, `computeRouteFeeRequiredVnd`, `getDriverWalletSummary`, `listDriverWalletTransactions`, `topUpDriverWallet` | `walletRepository` → wallets, wallet_transactions | Sync actions to `users` for identity lookup; same-domain monetary helpers; sync action to `routes` for fee reservation/charge flows | `wallet.created`, `wallet.topped_up`, `wallet.transaction.recorded`, `wallet.balance.changed` |
| `routes` | `src/services/driverRouteService.ts` | `createRoute`, `listRoutesByDriver`, `getRoute`, `updateRoute`, `publishRoute` | `driverRouteRepository` → routes; `tripListRepository` → trip visibility / scope views | Sync actions to `users` for driver validation; sync actions to `wallets` for publish-time fee checks; same-domain trip-list helpers | `route.created`, `route.updated`, `route.published`, `route.unpublished` |
| `plans` | `src/services/planService.ts` | `createPlan`, `listPlansByClient`, `getPlan`, `updatePlan`, `cancelPlanByClient` | `planRepository` → plans; `tripListRepository` → trip visibility / scope views | Sync actions to `users` for client validation; same-domain trip-list helpers; sync actions to `demand-groups` for downstream grouping | `plan.created`, `plan.updated`, `plan.cancelled` |
| `route-requests` | `src/services/routeRequestService.ts` | `createRouteRequest`, `acceptRouteRequest`, `declineRouteRequest`, `cancelRouteRequest`, `listRouteRequestsByDriver`, `listRouteRequestsByClient`, `listRouteRequestsByRoute` | `routeRequestRepository` → route_requests | Sync actions to `routes`, `plans`, `users`; same-domain request state machine helpers; sync actions to `notifications` for inbox fan-out | `route-request.created`, `route-request.accepted`, `route-request.declined`, `route-request.cancelled` |
| `group-requests` | `src/services/groupRequestService.ts` | `createGroupRequest`, `listGroupRequestsByDriver`, `cancelGroupRequest` | `groupRequestRepository` → group_requests; related offer rows | Sync actions to `demand-groups`, `plans`, `users`; same-domain sibling request/offer helpers; event-driven decline cascade coordination | `group-request.created`, `group-request.cancelled`, `group-request.declined` |
| `group-offers` | `src/services/groupOfferService.ts` | `listGroupOffersByClient`, `acceptGroupOffer`, `declineGroupOffer` | `groupOfferRepository` → group_offers | Sync actions to `group-requests`, `routes`, `plans`, `users`; same-domain offer state helpers; async event consumers for declination cascades | `group-offer.created`, `group-offer.accepted`, `group-offer.declined` |
| `demand-groups` | `src/services/demandGroupService.ts` | `getDemandGroup`, `listDemandGroupMembers` | `demandGroupRepository` → demand-group projections; `planRepository` for plan lookup | Same-domain with `plans`; sync actions to `matching` and `journeys` for read models; event-driven projection updates | `demand-group.derived`, `demand-group.refreshed` |
| `matching` | `src/services/matchingService.ts` | `searchRoutes`, `routeExists`, `listMatchedDemandGroups`, `listPendingInboundRouteRequests` | `routeRequestRepository` + matching query projections | Sync actions to `routes`, `plans`, `demand-groups`; same-domain scoring helpers; event consumption from route/plan/request changes | `match.candidate.updated`, `match.results.generated` |
| `journeys` | `src/services/journeyService.ts` | `buildJourneySummary` and journey aggregate helpers | `journeyRepository` → journeys, saved_locations, route request / group offer join views | Sync actions to `routes`, `plans`, `users`, `reviews`; same-domain summary helpers; event consumers for completed/cancelled trips | `journey.started`, `journey.completed`, `journey.cancelled` |
| `reviews` | `src/services/reviewService.ts` | `createReview`, `listReviewsByReviewer` | `reviewRepository` → reviews; `journeyRepository` for eligibility context | Sync actions to `journeys` and `users`; same-domain eligibility helpers; async consumers for reputation projections | `review.created`, `review.updated` |
| `reports` | `src/services/reportService.ts` | `createReport`, `listReportsByReporter` | `reportRepository` → reports | Sync actions to `users` and `journeys`; same-domain moderation helpers; async consumers for safety / moderation queues | `report.created`, `report.updated` |
| `notifications` | `src/services/notificationService.ts` | `buildNotificationCopy`, `emitNotification`, `listNotifications`, `createNotification`, `markNotificationRead`, `markAllNotificationsRead` | `notificationRepository` → notifications | Sync actions from all user-facing services; same-domain copy helpers; event sink for domain events | `notification.created`, `notification.read`, `notification.read_all` |
| `client-inbox` | `src/services/clientInboxService.ts` | `listClientInbox` | `clientInboxRepository` → client inbox hydrated read model | Async consumers of `route-requests`, `group-offers`, and `notifications` events; same-domain read-model hydration helpers; no direct write-side dependencies | `client-inbox.refreshed`, `client-inbox.hydrated` |
| `cars` | `src/services/carService.ts` | `createCar`, `listCarsByOwner`, `getCarById`, `updateCar`, `deleteCar` | `carRepository` → cars | Sync actions to `users`; same-domain owner/vehicle helpers; event consumers for driver profile updates | `car.created`, `car.updated`, `car.deleted` |
| `integrations.vnmap` | `src/services/vnmapProxyService.ts` | `proxyRequest` | No owned DB tables; external VNMap API contract | Same-domain only as an integration adapter; sync action boundary for geocoding / routing lookups | `integration.vnmap.requested`, `integration.vnmap.failed` |
| `integrations.zalo` | `src/services/zaloProxyService.ts` | `proxyProfile`, `proxySecretExchange` | No owned DB tables; external Zalo API contract | Same-domain only as an integration adapter; sync action boundary for profile / auth exchange | `integration.zalo.profile.requested`, `integration.zalo.secret_exchange.requested` |

## Dependency classification rules

Classify future service relationships like this:

- **Same-domain**: helpers or read-model access that stay within one business area and can remain local during the strangler phase.
- **Synchronous action**: a caller needs an immediate response from another service and should invoke an explicit action contract.
- **Asynchronous event**: a service reacts to an emitted domain event and should not depend on immediate return values.

Use the weakest dependency that satisfies the use case.
If a dependency crosses business boundaries, prefer a contract-first action or event rather than importing a sibling service module directly.

## Initial candidate migration order

Lowest risk to highest risk:

1. `integrations.vnmap` — pure adapter, no persistence ownership.
2. `integrations.zalo` — pure adapter, no persistence ownership.
3. `cars` — narrow CRUD surface, single repository.
4. `reports` — simple write/read flow, low coupling.
5. `reviews` — simple write/read flow with journey eligibility lookup.
6. `notifications` — shared sink, but can be isolated behind explicit event intake.
7. `client-inbox` — read-model projection over notifications, route requests, and group offers; low write risk.
8. `users` — foundational identity and mode/block state, but still mostly CRUD-like.
9. `wallets` — monetary behavior raises correctness sensitivity.
10. `routes` — driver route lifecycle and publish flow, more downstream dependencies.
11. `plans` — similar lifecycle complexity with trip-list views.
12. `journeys` — aggregate/summary service with cross-entity reads.
13. `demand-groups` — projection-style service feeding matching and inboxes.
14. `route-requests` — workflow-heavy state machine with several downstream effects.
15. `group-requests` — cross-entity workflow plus cascade decline behavior.
16. `group-offers` — acceptance/decline fan-out and cascade interactions.
17. `matching` — most sensitive to correctness because it drives route discovery and ranking.

## Migration notes

- Start by freezing the action contract in docs and test fixtures before any runtime change.
- Keep Express as the outer HTTP layer during the strangler phase; route/controller behavior should continue to call the existing service APIs.
- Introduce Moleculer broker wiring only after the service contracts are stable and the first service can be moved behind the contract without changing responses.
- Move endpoints incrementally, one service area at a time, and preserve response payloads while the transport changes behind the scenes.
