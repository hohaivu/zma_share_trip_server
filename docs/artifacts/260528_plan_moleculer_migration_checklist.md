# Implementation Plan: MoleculerJS Migration Checklist

This plan turns the MoleculerJS migration checklist discussion into a reviewable implementation artifact for `zma_share_trip_server`. The current backend is an Express TypeScript API with a layered MVC shape: `routes -> controllers -> services -> repositories`, provider-based startup, centralized database access, and RPC-style HTTP endpoints. The intended end state is an incremental path toward MoleculerJS without changing the public API or rewriting the backend in one step.

---

## Goal

Prepare `zma_share_trip_server` for a future MoleculerJS migration by documenting service boundaries, action contracts, transaction ownership, API gateway strategy, configuration, observability, and verification steps before implementation begins.

The migration should be staged. First, keep the current Express server and introduce Moleculer-compatible contracts and documentation. Later, add a local `ServiceBroker`, wrap low-risk services as actions, route existing controllers through `broker.call`, then split services into separate nodes only after behavior, tests, and observability are stable.

Non-goals for this plan: do not add Moleculer dependencies yet, do not modify runtime behavior yet, do not replace Express routing yet, do not split the database yet, and do not change public API paths, request bodies, response envelopes, or error shapes unless separately approved.

---

## User Review Required

> [!IMPORTANT]
> **Migration Strategy**
> Approve a staged migration rather than a big-bang rewrite. Recommended sequence: preserve Express, define action contracts, add a local Moleculer broker later, migrate low-risk services first, then consider transporters and multi-node deployment.

> [!IMPORTANT]
> **API Compatibility**
> The existing frontend-facing API should remain stable. Current RPC-style endpoints in `API.md` should continue to accept the same JSON bodies and return the same response/error envelopes while internal handlers move toward Moleculer actions.

> [!IMPORTANT]
> **Database and Transaction Ownership**
> The first Moleculer phase should keep a shared database and existing repository layer. Workflows using local transactions, especially accept/decline, journey, wallet, matching, and group offer flows, should not be split across remote services until saga/idempotency/event rules are designed.

> [!IMPORTANT]
> **Gateway Choice**
> Decide whether the long-term HTTP gateway remains Express or moves to `moleculer-web`. Recommended first step is keeping Express as the gateway and calling Moleculer actions internally.

---

## Open Questions

> [!NOTE]
> **Question 1: Why Moleculer?**
> Is the main goal code organization, horizontal scaling, async event workflows, operational isolation, or all of these? This affects how aggressively services should be split.
>
> **Question 2: Deployment Topology**
> Will the backend continue as one Render service initially, or should the migration prepare for multiple services/nodes with a transporter such as NATS, Redis, RabbitMQ, or Kafka?
>
> **Question 3: First Migration Candidate**
> Which domain should be migrated first when implementation starts? Low-risk candidates are `vnmapProxyService`, `zaloProxyService`, or read-heavy profile/notification actions.
>
> **Question 4: Validation Strategy**
> Should Moleculer actions reuse the current Zod schemas, translate schemas into Moleculer's built-in validator format, or support both during transition?
>
> **Question 5: Event Durability**
> Should future events use basic Moleculer events first, or should durable processing with `moleculer-channels` be planned for notifications, fan-out, and wallet-related side effects?

---

## Proposed Changes

### Layer 1: Migration Documentation

Create and update documentation so implementation can proceed in small, reviewable phases.

#### [NEW] [moleculer-migration.md](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/docs/moleculer-migration.md)
- Document the phased migration sequence: preparation, local broker, low-risk action wrappers, domain action migration, event extraction, optional multi-node split.
- Record explicit non-goals for early phases: no public API changes, no database split, no required transporter, no distributed transactions.
- Define the recommended initial runtime shape: Express gateway plus local Moleculer `ServiceBroker` once implementation begins.
- Include rollback guidance for each phase.

#### [MODIFY] [moleculer-service-map.md](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/docs/moleculer-service-map.md)
- Map current service modules to future Moleculer services, including `users`, `cars`, `driverRoutes`, `clientPlans`, `matching`, `journeys`, `wallet`, `notifications`, `groupRequests`, `groupOffers`, `routeRequests`, `clientInbox`, `zalo`, and `vnmap`.
- Define initial action names such as `driverRoutes.create`, `clientPlans.cancel`, `matching.searchRoutes`, `zalo.exchangePhone`, and `vnmap.autocomplete`.
- Mark each service as low, medium, or high migration risk based on cross-domain writes and transaction usage.
- Identify candidate events such as `user.created`, `route.created`, `plan.created`, `groupOffer.accepted`, `routeRequest.accepted`, `journey.completed`, `notification.created`, and `wallet.transaction.created`.

#### [MODIFY] [service-boundary-inventory.md](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/docs/service-boundary-inventory.md)
- Add a table of current service dependencies and future action/event boundaries.
- Identify direct service-to-service imports that should eventually become action calls or event emissions.
- Identify repository/table ownership for each future service while keeping the shared database in the first phase.
- Flag workflows that should stay co-located until transaction strategy is designed.

#### [MODIFY] [migration-plan.md](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/docs/migration-plan.md)
- Add Moleculer migration as a future staged track, not an immediate framework rewrite.
- Link to the new migration checklist and service map documents.
- Add acceptance criteria for each migration phase.

---

### Layer 2: Current Architecture Boundaries

Keep current Express/MVC structure stable while making future Moleculer action boundaries explicit.

#### [MODIFY] [mvc-contract.md](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/docs/mvc-contract.md)
- Extend the existing `routes -> controllers -> services -> repositories` contract with Moleculer-ready rules.
- State that service functions should accept plain serializable inputs and return plain serializable outputs.
- State that services must not depend on Express `Request` or `Response` objects.
- State that repositories remain the only database access layer.
- State that new cross-domain dependencies should be documented as future actions/events before adding direct imports.

#### [MODIFY] [README.md](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/README.md)
- Add a short section linking to Moleculer migration docs.
- Clarify that Express remains the active runtime until a separate implementation phase introduces a broker.
- Keep current validation commands unchanged.

#### [MODIFY] [API.md](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/API.md)
- Add a note that current HTTP paths and response envelopes are the compatibility contract for future Moleculer gateway work.
- Do not change endpoint definitions unless a coordinated API change is approved.
- Optionally add a future route-to-action mapping section without altering existing API behavior.

---

### Layer 3: Future Broker Runtime Design

Design the files that would be added when implementation is explicitly approved.

#### [NEW] [moleculer.config.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/moleculer.config.ts)
- Define future broker settings: `nodeID`, namespace, log level, request timeout, retry policy, circuit breaker, metrics, tracing, and optional transporter.
- Read configuration from a centralized env module rather than scattered `process.env` access.
- Keep transporter disabled in the initial local-broker phase unless multi-node deployment is approved.

#### [NEW] [src/broker.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/broker.ts)
- Create and export a future broker factory.
- Load local service schemas when implementation begins.
- Provide start/stop helpers for integration with the current startup flow.

#### [MODIFY] [src/index.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/index.ts)
- In the future implementation phase, start the broker after database connectivity succeeds and before the HTTP server begins listening.
- Add graceful shutdown for broker and database pool.
- Preserve current provider registration order: HTTP, routes, health, error handling.

#### [MODIFY] [src/kernel.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/kernel.ts)
- In the future implementation phase, decide whether `Kernel` should expose broker access through provider context or whether controllers receive action callers through dependency injection.
- Avoid coupling low-level services directly to Express app state.

---

### Layer 4: Future Service Action Wrappers

Prepare current service modules to become Moleculer actions without changing behavior first.

#### [NEW] [src/moleculer/services/vnmap.service.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/moleculer/services/vnmap.service.ts)
- Future low-risk first candidate: wrap existing VNMap proxy service functions as actions.
- Define actions for autocomplete, place details, and directions.
- Add timeout, retry, circuit breaker, and provider error normalization rules.

#### [NEW] [src/moleculer/services/zalo.service.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/moleculer/services/zalo.service.ts)
- Future low-risk candidate: wrap existing Zalo proxy service functions as actions.
- Keep secret handling in settings/config.
- Normalize provider errors to the current HTTP error shape through gateway/controller mapping.

#### [NEW] [src/moleculer/services/driver-routes.service.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/moleculer/services/driver-routes.service.ts)
- Future medium-risk domain candidate: expose driver route actions such as `create`, `list`, `get`, `update`, and match-related list actions.
- Keep repository writes local and avoid remote calls inside route write transactions.
- Reuse current service functions until deeper refactoring is justified.

#### [NEW] [src/moleculer/services/matching.service.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/moleculer/services/matching.service.ts)
- Future higher-risk candidate: expose matching actions only after performance and data dependency boundaries are clear.
- Avoid remote broker calls inside tight ranking/scoring loops.
- Document caching and invalidation before enabling distributed execution.

---

### Layer 5: Validation, Errors, and Contracts

Make request validation and error behavior reusable outside Express.

#### [MODIFY] [src/middleware/validate.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/middleware/validate.ts)
- In a future implementation phase, extract reusable schema parsing helpers that can be called from both Express middleware and Moleculer action handlers.
- Preserve current validation response shape.

#### [MODIFY] [src/http-error.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/http-error.ts)
- Define how current HTTP errors map to future Moleculer action errors.
- Preserve status code and response envelope compatibility at the HTTP boundary.

#### [MODIFY] [src/shared/responseEnvelope.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/shared/responseEnvelope.ts)
- Treat current success/error envelopes as the gateway compatibility contract.
- Add tests before any internal action migration touches response mapping.

---

### Layer 6: Database and Transaction Strategy

Document transaction boundaries before any service split.

#### [MODIFY] [src/db/connection.ts](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/src/db/connection.ts)
- Do not change behavior in the planning phase.
- In future implementation, keep `query` and `withTransaction` as shared infrastructure for the single-database phase.
- Add documentation for local transaction limits before any distributed service split.

#### [MODIFY] [docs/service-boundary-inventory.md](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/docs/service-boundary-inventory.md)
- Identify every current `withTransaction` workflow.
- Classify transactions as single-domain, cross-domain, or external-provider-involved.
- Mark high-risk workflows that require saga/idempotency design before remote service splitting.

---

### Layer 7: Package Scripts and Dependencies

Prepare package changes for a later implementation phase.

#### [MODIFY] [package.json](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/package.json)
- In the future implementation phase, add `moleculer` and optionally `moleculer-web`.
- Add scripts such as `dev:moleculer`, `start:moleculer`, or `broker:repl` only when broker runtime is introduced.
- Keep current scripts such as `dev`, `build`, `typecheck`, `mvc:guardrails`, and `test` unchanged during preparation.

#### [MODIFY] [.env.example](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/.env.example)
- In the future implementation phase, add optional broker-related variables such as namespace, node ID, request timeout, and transporter URL.
- Keep transporter variables optional until multi-node deployment is approved.

---

### Layer 8: Deployment and Operations

Plan production rollout without changing current deployment now.

#### [MODIFY] [render.yaml](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/render.yaml)
- Do not change deployment until broker runtime is implemented.
- Later, update start command only after local validation proves Express plus broker startup is stable.
- Add readiness checks only after health endpoint includes broker status.

#### [MODIFY] [docker-compose.test.yml](file:///Users/vuho/Development/ALI/superapp/miniapps/zma_share_trip/zma_share_trip_server/docker-compose.test.yml)
- Later, add optional transporter services only if multi-node or durable-event testing is approved.
- Keep existing database-backed test behavior stable.

---

## Verification Plan

### Automated Tests

- Validate TypeScript after any future code changes:
  ```bash
  npm run typecheck
  ```

- Validate MVC boundaries after adding or moving endpoint/controller/service code:
  ```bash
  npm run mvc:guardrails
  ```

- Run the existing test suite:
  ```bash
  npm test
  ```

- Build the production-style artifact:
  ```bash
  npm run build
  ```

### Manual Verification

- Confirm the health endpoint remains available after any future broker startup changes:
  ```bash
  curl http://localhost:3010/health
  ```

- Confirm a representative existing endpoint keeps the same HTTP path, method, request body, and response envelope before and after an action-wrapper migration.

- For the first low-risk Moleculer action candidate, compare Express-controller direct service behavior with `broker.call` behavior using the same inputs.

- Review logs to confirm future broker startup, shutdown, action errors, and provider errors include a request or correlation ID.

- Before committing implementation changes later, run GitNexus change detection as required by the repository instructions:
  ```bash
  gitnexus detect-changes
  ```

### Documentation Review

- Confirm `docs/moleculer-migration.md` documents phased rollout and rollback.
- Confirm `docs/moleculer-service-map.md` lists every current domain service and proposed action names.
- Confirm `docs/service-boundary-inventory.md` identifies high-risk transaction workflows before any service split.
- Confirm `API.md` still represents the public compatibility contract.
