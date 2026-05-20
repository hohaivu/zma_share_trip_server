# Cùng Tuyến — Phase 2 Server API

> Express.js API server backed by Postgres. Data is durable across restarts and requires a `DATABASE_URL` during startup. Development uses `yarn db:schema`, `yarn db:seed`, and `yarn dev`; the production-style artifact flow uses `yarn build`, `yarn db:schema:dist`, `yarn db:seed:dist`, and `yarn start`.

**Base URL**: `http://localhost:3010/api`

---

## Preserved Endpoints (Zalo Proxy)

| Method | Path            | Description                            | Status    |
| ------ | --------------- | -------------------------------------- | --------- |
| POST   | `/authorize`    | Exchange Zalo auth code for tokens     | Unchanged |
| POST   | `/user-info`    | Get user profile via Zalo access token | Unchanged |
| POST   | `/phone-number` | Get phone number via Zalo token + code | Unchanged |
| POST   | `/location`     | Get location data via Zalo token       | Unchanged |

## Cars

| Method | Path             | Description                                                                           |
| ------ | ---------------- | ------------------------------------------------------------------------------------- |
| POST   | `/cars`          | Create a car. Body: `{ ownerId, plateNumberFull, brand, model, color, seatCapacity }` |
| GET    | `/cars?ownerId=` | List cars by owner                                                                    |
| PUT    | `/cars/:id`      | Update a car                                                                          |
| DELETE | `/cars/:id`      | Delete a car                                                                          |

## Driver Routes

| Method | Path                | Description                                                                                                |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST   | `/routes`           | Create route. Body: `{ driverId, carId, origin, destination, departureWindowStartDate, departureWindowEndDate, tripPrice, ... }` |
| GET    | `/routes?driverId=` | List routes by driver                                                                                      |
| GET    | `/routes/:id`       | Route detail                                                                                               |
| PUT    | `/routes/:id`       | Update route                                                                                               |

### Route Matching

| Method | Path                                  | Description                                               |
| ------ | ------------------------------------- | --------------------------------------------------------- |
| GET    | `/routes/:id/matched-demand-groups`   | Matched demand groups (exact_3/near_3, visibility, price) |
| GET    | `/routes/:id/inbound-search-requests` | Pending/resolved search requests for this route           |

## Client Trip Plans

| Method | Path                    | Description                                                                                                                                                 |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/trip-plans`           | Create client plan. Body: `{ clientId, pickup, dropoff, pickupWardId, dropoffWardId, departureWindowStartDate, departureWindowEndDate, passengerCount }` |
| GET    | `/trip-plans?clientId=` | List client plans by client                                                                                                                                 |
| GET    | `/trip-plans/:id`       | Client plan detail                                                                                                                                          |
| PUT    | `/trip-plans/:id`       | Update client plan                                                                                                                                          |

## User Bootstrap

| Method | Path               | Description                                                                         |
| ------ | ------------------ | ----------------------------------------------------------------------------------- |
| POST   | `/users/bootstrap` | Resolve or create an app user from MAUID. Body: `{ mauid, displayName, avatarUrl }` |

**Response**: The canonical user profile with backend UUID `id`, external `mauid`, display fields, and any persisted mode/trust fields.

- Returns `201` for first-time user creation
- Returns `200` for existing user resolution (updates display fields)
- Returns `400` if `mauid`, `displayName`, or `avatarUrl` is missing

> **Identity model**: `users.id` is an internal UUID primary key. `users.mauid` is the external Zalo Mini App app-scoped identifier from `getUserID()`. All app-owned ownership fields (`ownerId`, `driverId`, `clientId`) reference backend UUID `id`, not `mauid`. `mauid` is preserved on user projections for Zalo-native actions like `openChat()`.

## User Mode Preference

| Method | Path              | Description                                                          |
| ------ | ----------------- | -------------------------------------------------------------------- |
| POST   | `/users/:id/mode` | Save preferred mode. Body: `{ preferredMode: "driver" \| "client" }` |
| GET    | `/users/:id/mode` | Read preferred mode                                                  |

**Response**: `{ preferredMode, modeSelectedAt }`

> The `:id` parameter is the backend UUID returned by bootstrap, not the MAUID.

## Demand Groups

| Method | Path                         | Description                                                                 |
| ------ | ---------------------------- | --------------------------------------------------------------------------- |
| GET    | `/demand-groups/:id`         | Group summary (departureWindowStartDate, wards, window, memberCount, totalPassengerCount) |
| GET    | `/demand-groups/:id/members` | Member trip plans (exact-3 visibility only)                                 |

> Demand groups are computed on-read from published `grouped` client plans.
> Demand group calendar day is based on canonical UTC `departureWindowStartDate`.
> Group ID format: `dg-{departureWindowStartDate.slice(0,10)}|{pickupWardId}|{dropoffWardId}|{departureWindowStartDate}`

## Group Requests (Driver → Group)

| Method | Path                         | Description                                                                                |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------ |
| POST   | `/group-requests`            | Create group request + fan-out offers. Body: `{ driverId, routeId, demandGroupId, note? }` |
| GET    | `/group-requests?driverId=`  | List driver's sent group requests                                                          |
| POST   | `/group-requests/:id/cancel` | Cancel group request + close pending offers                                                |

**Response** (POST create): `{ groupRequest, offers: [...] }`

## Group Offers (Client Inbox)

| Method | Path                        | Description                            |
| ------ | --------------------------- | -------------------------------------- |
| GET    | `/group-offers?clientId=`   | Client's received group offers         |
| POST   | `/group-offers/:id/accept`  | Accept group offer (first-accept-wins) |
| POST   | `/group-offers/:id/decline` | Decline group offer                    |

### Group Offer Statuses

- `pending` — awaiting client response
- `accepted` — client accepted (route bound)
- `declined` — client declined
- `closed` — auto-closed (sibling won, request canceled, or route taken)

## Search Requests (Client → Route)

| Method | Path                           | Description                                                          |
| ------ | ------------------------------ | -------------------------------------------------------------------- |
| POST   | `/search-requests`             | Create search request. Body: `{ clientId, planId?, routeId, note? }` |
| GET    | `/search-requests?driverId=`   | Driver's inbound search requests                                     |
| GET    | `/search-requests?clientId=`   | Client's sent search requests                                        |
| POST   | `/search-requests/:id/accept`  | Driver accepts search request                                        |
| POST   | `/search-requests/:id/decline` | Driver declines search request                                       |

> Search requests can optionally reference an existing client plan, but planId is not required for ad hoc requests.

## Journey Summary & Completion

| Method | Path                  | Description                                                                                           |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/trips/:id/summary`  | Shared journey summary with accepted counterpart; the underlying draft remains a route or client plan |
| POST   | `/trips/:id/complete` | Mark the shared journey as completed                                                                  |

> These are stable journey-lifecycle endpoints. They expose accepted shared state derived from route or client-plan records without renaming the public backend path.

## Saved Locations (Deprecated)

| Method | Path                         | Description                    |
| ------ | ---------------------------- | ------------------------------ |
| GET    | `/trips/saved-locations`     | List saved locations           |
| POST   | `/trips/saved-locations`     | Create saved location (max 10) |
| DELETE | `/trips/saved-locations/:id` | Delete saved location          |

---

## Removed Legacy Endpoints

| Legacy Path                    | Replacement                                                             |
| ------------------------------ | ----------------------------------------------------------------------- |
| `POST /trips/demands`          | `POST /trip-plans`                                                      |
| `GET /trips/demands?clientId=` | `GET /trip-plans?clientId=`                                             |
| `PUT /trips/demands/:id`       | `PUT /trip-plans/:id`                                                   |
| `POST /trips/routes`           | `POST /routes`                                                          |
| `GET /trips/routes?driverId=`  | `GET /routes?driverId=`                                                 |
| `PUT /trips/routes/:id`        | `PUT /routes/:id`                                                       |
| `GET /matches?tripId=`         | `GET /routes/:id/matched-demand-groups` or `POST /client/search-routes` |
| `POST /offers`                 | `POST /group-requests` or `POST /search-requests`                       |
| `POST /offers/:id/accept`      | `POST /group-offers/:id/accept` or `POST /search-requests/:id/accept`   |
| `POST /offers/:id/decline`     | `POST /group-offers/:id/decline` or `POST /search-requests/:id/decline` |
| `GET /offers?driverId=`        | `GET /group-requests?driverId=` or `GET /search-requests?driverId=`     |
| `GET /offers?clientId=`        | `GET /group-offers?clientId=` or `GET /search-requests?clientId=`       |

## Removed Fields

| Field            | Was On       | Replacement                                             |
| ---------------- | ------------ | ------------------------------------------------------- |
| `availableSeats` | Route        | Removed; seat capacity is on Car                        |
| `pricePerSeat`   | Route, Offer | `tripPrice` (single number per route)                   |
| `seatCount`      | Offer        | Not applicable; single accepted client per route in MVP |
| `clientDemandId` | Match        | Replaced by demand group and client plan references     |
| `shareableSeats` | Car          | Removed from decision logic; `seatCapacity` retained    |

---

## Response Envelope

> Introduced in **ALI-55**. New and migrated endpoints emit the shapes below. Legacy endpoints retain their raw payloads until each is migrated.

### Success envelope

Every migrated handler returns success as:

```json
{ "data": <payload> }
```

List/collection endpoints additionally carry a `meta` block with at least a `count`:

```json
{ "data": [ ... ], "meta": { "count": 3 } }
```

The HTTP status code expresses intent (`200` for reads, `201` for resource creation, `204` reserved for no-content). The `meta` block is reserved for collection metadata (count today, cursors/links in the future).

### Error envelope

Every error response uses:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "issues": [ ... ], "details": <unknown> } }
```

- `code` is a stable machine-readable string. For `HttpError` thrown from controllers/services the global handler maps the HTTP status to `HTTP_<status>` (`HTTP_400`, `HTTP_404`, `HTTP_409`, `HTTP_500`). Validation failures from `validateSchema` (ALI-54) emit `VALIDATION_ERROR`.
- `message` is a human-readable summary. For `500` responses the message is always the generic `"Internal server error"`; the underlying error is logged server-side.
- `issues` is present when the error carries per-field validation results (see "Validation Errors" below).
- `details` is optional and only appears when a service/controller explicitly opts in with `HttpError.withSafeDetails(...)` for a non-500 response. Plain `HttpError` payloads and all `500` responses omit `details` to avoid exposing internal state.

### Migrated endpoints

| Method | Path                                            | Before                                                                 | After                                              |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/driver/wallet`                            | Bare summary object                                                    | `{ "data": <summary> }`                            |
| GET    | `/api/driver/wallet/transactions`               | `{ "items": [ ... ] }`                                                 | `{ "data": [ ... ], "meta": { "count": N } }`      |
| POST   | `/api/driver/wallet/topups`                     | `{ "summary": ..., "transaction": ... }`                               | `{ "data": { "summary": ..., "transaction": ... } }` |
| GET    | `/api/client/incoming-driver-offers`            | Bare array                                                             | `{ "data": [ ... ], "meta": { "count": N } }`      |
| POST   | `/api/client/group-offers/:id/accept`           | Bare result object                                                     | `{ "data": <result> }`                             |
| POST   | `/api/client/group-offers/:id/decline`          | Bare result object                                                     | `{ "data": <result> }`                             |

All `HttpError`-driven 4xx/5xx responses across the API now use the error envelope above (previously `{ "error": -1, "message": "..." }` or `{ "message": "..." }`).

### Client compatibility note

The current Zalo Mini App consumes these endpoints directly. Adopting the envelope **is a breaking response-shape change**. Coordinate with the mobile team before deploying — either:

1. Pin the mobile build to a backend version that still emits raw payloads while the new envelope rolls out behind a versioned route prefix (e.g. `/api/v2/...`), **or**
2. Land the envelope and the corresponding mobile client update together in a coordinated release.

Until that coordination is confirmed, treat ALI-55 as **server-side only** and gate deploys accordingly.

---

## Validation Errors

Request validation lives in `src/middleware/validate.ts` (zod-backed) and runs **before** the controller handler. Failed validation short-circuits with HTTP `400` and the following JSON envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "issues": [
      {
        "path": ["amountVnd"],
        "message": "amountVnd must be a positive integer",
        "code": "too_small"
      }
    ]
  }
}
```

Fields:

| Field                  | Type       | Description                                                                                |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `error.code`           | string     | Always `"VALIDATION_ERROR"` for validation failures.                                       |
| `error.message`        | string     | Stable human-readable summary (`"Invalid request"`).                                       |
| `error.issues`         | array      | One entry per failed rule from the underlying zod schema.                                  |
| `error.issues[].path`  | string[]   | Dotted-path segments to the offending field (e.g. `["amountVnd"]`, `["body", "driverId"]`). |
| `error.issues[].message` | string   | Per-rule human-readable message.                                                            |
| `error.issues[].code`  | string     | Stable zod issue code (`too_small`, `invalid_type`, `custom`, etc.).                       |

> Validation errors share the same envelope as domain errors (see "Response Envelope" above) — they simply use the `VALIDATION_ERROR` code and carry `issues`. Domain `HttpError` responses use `HTTP_<status>` codes and omit `issues`.

The current schema-validated endpoints are:

| Method | Path                          | Body schema (`src/schemas/`)             |
| ------ | ----------------------------- | ---------------------------------------- |
| POST   | `/api/driver/wallet/topups`   | `driverWallet.ts` → `manualTopUpBodySchema` |

---

## Orchestration Rules

1. **First-accept-wins**: The first client to accept a group offer or the first driver to accept a search request wins the route.
2. **Sibling closure**: When a group offer is accepted, all other pending offers from the same group request are auto-closed.
3. **Route exclusivity**: One route can have only one accepted client (via group offer OR search request).
4. **Cross-flow blocking**: An accepted group offer blocks pending search requests for that route, and vice versa.
