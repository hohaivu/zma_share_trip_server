# Wave 0 MVC Contract

This document defines the shared MVC contract for ALI-37 so later parallel refactor work can move endpoints consistently. Lightweight automated guardrails now enforce the first boundary rule: route and controller TypeScript files must not import the shared store directly.

## Layer responsibilities

### Routes (`src/routes`)

Routes own HTTP wiring only.

- Declare Express paths, HTTP verbs, and route-level middleware.
- Parse path/query/body inputs only enough to call a controller.
- Delegate business decisions to controllers or services; do not embed domain workflows in route files.
- Return through the controller response contract rather than constructing unrelated response shapes inline.

### Controllers (`src/controllers`)

Controllers own request/response orchestration.

- Translate Express `Request` data into service input objects.
- Validate request shape and required fields at the HTTP boundary.
- Call one or more services to fulfill a use case.
- Convert service results into API responses documented in `API.md`.
- Map known failures to stable HTTP status codes and error payloads.
- Do not directly access persistence tables or shared in-memory state except through an approved service/repository/facade.

### Services (`src/services`)

Services own application and domain behavior.

- Implement use cases and domain rules independent of Express.
- Coordinate repositories and other services.
- Return typed domain/application results instead of Express responses.
- Throw or return known application errors that controllers can map to HTTP errors.
- Avoid importing routes or controllers.

`src/services/domainServices.ts` is the current shared service module. Later refactor work may split it by resource/use case while preserving this contract.

### Repositories (`src/repositories`)

Repositories own persistence access.

- Encapsulate reads/writes to Postgres-backed storage or persistence adapters.
- Expose data-access methods to services.
- Keep SQL/storage details out of controllers and routes.
- Do not depend on Express, routes, or controllers.

`src/repositories/walletRepository.ts` is the current repository example. New repositories should follow the same dependency direction.

## Where new endpoints go

When adding or moving an endpoint:

1. Add the Express path and middleware in the appropriate file under `src/routes`.
2. Add a controller function under `src/controllers` for HTTP input/output handling.
3. Add or reuse a service function under `src/services` for the use case.
4. Add or reuse a repository under `src/repositories` only when persistence access is needed.
5. Document the endpoint contract in `API.md` and keep README endpoint summaries high level.

Namespace ownership remains:

- Shared journey/base resources: `/api/...`
- Driver-owned resources and actions: `/api/driver/...`
- Client-owned resources and actions: `/api/client/...`

## Dependency and import direction

Allowed dependency direction is top-down:

```text
src/routes -> src/controllers -> src/services -> src/repositories -> storage/adapters
```

Supporting shared modules may be imported where appropriate if they do not invert the layer direction. Examples include request helpers, error helpers, shared types, and compatibility facades.

Run the MVC boundary guardrail before completing endpoint or refactor work:

```bash
yarn mvc:guardrails
```

The guardrail checks TypeScript files under `src/routes` and `src/controllers` and fails with actionable file/line violations when either layer imports `src/store.ts` directly through relative paths such as `../store` or `../../store`.

Do not introduce imports in the opposite direction:

- Repositories must not import services, controllers, or routes.
- Services must not import controllers or routes.
- Controllers must not import route modules.
- Route files must not reach directly into repositories or storage when a controller/service boundary exists.

## Request, response, and error conventions

- Validate request body, query, and path parameters at the controller boundary or via route middleware specifically assigned to validation.
- Keep service APIs Express-free: pass plain input objects and receive plain results.
- Preserve existing response shapes unless a coordinated API change is explicitly planned and reflected in `API.md`.
- Prefer stable JSON error payloads with an error/message field and an appropriate HTTP status.
- Use existing HTTP error utilities when available instead of inventing endpoint-specific error formats.
- Do not expose repository/storage errors directly to clients; map them to known controller-level responses.

## Shared store compatibility facade policy

`src/store.ts` remains a deliberate compatibility facade while MVC refactor work is in progress. It preserves existing shared behavior for areas that have not yet moved fully behind services and repositories.

- New MVC code should prefer services/repositories over direct `src/store.ts` access.
- Existing callers may continue using the store facade until their area is refactored.
- Routes and controllers must not import `src/store.ts` directly; use a service/repository boundary instead. This is enforced by `yarn mvc:guardrails`.
- If a future refactor requires changing store behavior, preserve exported compatibility methods or provide a documented migration path before removing them.
- Store facade changes must be treated as shared-contract changes because they can affect multiple endpoint areas.

## Remaining ALI-37 closing work

ALI-37 is not complete. The following acceptance items remain pending for later ALI-37 closing work:

- Source-code moves from routes into controllers/services/repositories.
- Broader lint rules or CI integration for the full dependency direction beyond the current store-import guardrail.
- Issue status changes or claims that ALI-37 is complete.

Contributors should run the guardrail and manually follow the remaining dependency-direction rules during endpoint and refactor work.
