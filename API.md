# Cùng Tuyến — Server API

> Express.js API server backed by Postgres. Data is durable across restarts and requires a `DATABASE_URL` during startup. Development uses `yarn db:schema`, `yarn db:seed`, and `yarn dev`; the production-style artifact flow uses `yarn build`, `yarn db:schema:dist`, `yarn db:seed:dist`, and `yarn start`.

**Base URL**: `http://localhost:3010`

---

## RPC-style API convention

Application-owned endpoints use an RPC-style HTTP surface:

- **Method**: `POST` for every application endpoint.
- **Body**: JSON request body only.
- **Identifiers**: send identifiers such as `id`, `driverId`, `clientId`, `routeId`, `planId`, `demandGroupId`, and `offerId` in the request body.
- **No path/query params**: application routes do not use `:id` path parameters or query-string filters.
- **Verb vocabulary**: paths end in `get`, `list`, `create`, `update`, `delete`, plus domain verbs such as `cancel`, `complete`, `accept`, `decline`, `read`, and `read-all`.
- **Carve-outs**: Zalo proxy endpoints remain `POST`; vnmap proxy endpoints and `/health` explicitly remain `GET`.

Example request:

```http
POST /api/drivers/routes/get
Content-Type: application/json

{ "id": "route-uuid", "driverId": "driver-uuid" }
```

---

## Application endpoints

### Driver cars

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/drivers/cars/list` | `{ "ownerId": "user-uuid" }` | List cars owned by a driver. |
| POST | `/api/drivers/cars/get` | `{ "id": "car-uuid", "ownerId": "user-uuid" }` | Get one car. |
| POST | `/api/drivers/cars/create` | `{ "ownerId", "plateNumberFull", "brand", "model", "color", "seatCapacity" }` | Create a car. |
| POST | `/api/drivers/cars/update` | `{ "id", "ownerId", ...fieldsToUpdate }` | Update a car. |
| POST | `/api/drivers/cars/delete` | `{ "id", "ownerId" }` | Delete a car. |

### Driver routes

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/drivers/routes/create` | `{ "driverId", "carId", "origin", "destination", "departureWindowStartDate", "departureWindowEndDate", "tripPrice", ... }` | Create a driver route. |
| POST | `/api/drivers/routes/list` | `{ "driverId": "user-uuid" }` | List routes for a driver. |
| POST | `/api/drivers/routes/get` | `{ "id": "route-uuid", "driverId": "user-uuid" }` | Get route detail. |
| POST | `/api/drivers/routes/update` | `{ "id", "driverId", ...fieldsToUpdate }` | Update a route. |
| POST | `/api/drivers/routes/matched-demand-groups/list` | `{ "routeId": "route-uuid", "driverId": "user-uuid" }` | List matched demand groups for a route. |
| POST | `/api/drivers/routes/inbound-search-requests/list` | `{ "routeId": "route-uuid", "driverId": "user-uuid" }` | List inbound search requests for a route. |

### Client trip plans

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/clients/trip-plans/create` | `{ "clientId", "pickup", "dropoff", "pickupWardId", "dropoffWardId", "departureWindowStartDate", "departureWindowEndDate", "passengerCount" }` | Create a client trip plan. |
| POST | `/api/clients/trip-plans/list` | `{ "clientId": "user-uuid" }` | List trip plans for a client. |
| POST | `/api/clients/trip-plans/get` | `{ "id": "plan-uuid", "clientId": "user-uuid" }` | Get trip plan detail. |
| POST | `/api/clients/trip-plans/update` | `{ "id", "clientId", ...fieldsToUpdate }` | Update a trip plan. |
| POST | `/api/clients/trip-plans/cancel` | `{ "id": "plan-uuid", "clientId": "user-uuid" }` | Cancel a trip plan. |

### Client route search and requests

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/clients/search-routes/list` | `{ "clientId", "pickupWardId", "dropoffWardId", "departureWindowStartDate", ... }` | Search available driver routes. |
| POST | `/api/clients/search-requests/create` | `{ "clientId", "routeId", "planId"?, "note"? }` | Create a client-to-route search request. |
| POST | `/api/clients/search-requests/cancel` | `{ "id": "search-request-uuid", "clientId": "user-uuid" }` | Cancel a sent search request. |
| POST | `/api/clients/route-requests/list` | `{ "clientId": "user-uuid" }` | List client route requests. |
| POST | `/api/clients/outgoing-route-requests/list` | `{ "clientId": "user-uuid" }` | List outgoing route requests sent by a client. |

> Search requests can optionally reference an existing client plan, but `planId` is not required for ad hoc requests.

### Demand groups

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/drivers/demand-groups/get` | `{ "id": "demand-group-id", "driverId"?: "user-uuid" }` | Get demand group summary. |
| POST | `/api/drivers/demand-groups/members/list` | `{ "demandGroupId": "demand-group-id", "driverId"?: "user-uuid" }` | List member trip plans for a demand group. |

> Demand groups are computed on-read from published `grouped` client plans.
> Demand group calendar day is based on canonical UTC `departureWindowStartDate`.
> Group ID format: `dg-{departureWindowStartDate.slice(0,10)}|{pickupWardId}|{dropoffWardId}|{departureWindowStartDate}`.

### Driver wallet

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/drivers/wallet/get` | `{ "driverId": "user-uuid" }` | Get driver wallet summary. |
| POST | `/api/drivers/wallet/transactions/list` | `{ "driverId": "user-uuid", "limit"?, "cursor"? }` | List wallet transactions. |
| POST | `/api/drivers/wallet/topups/create` | `{ "driverId": "user-uuid", "amountVnd": 100000 }` | Create a manual wallet top-up. |

### Group requests (Driver → Group)

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/drivers/group-requests/create` | `{ "driverId", "routeId", "demandGroupId", "note"? }` | Create a group request and fan-out offers. |
| POST | `/api/drivers/group-requests/list` | `{ "driverId": "user-uuid" }` | List a driver's sent group requests (hydrated). |
| POST | `/api/drivers/group-requests/cancel` | `{ "id": "group-request-uuid", "driverId": "user-uuid" }` | Cancel a group request and close pending offers. |

**Create response**: `{ "data": { "groupRequest": { ... }, "offers": [ ... ] } }`

**List response** — each item includes hydrated fields alongside existing fields:
```json
{
  "id": "greq-...",
  "driverId": "...",
  "routeId": "...",
  "status": "pending",
  "memberPlanIds": ["plan-a", "plan-b"],
  "route": { "origin": { "label": "Quận 1", "lat": 10.77, "lng": 106.69, "ward_name": "Phường Bến Nghé", "province_name": "Hồ Chí Minh" }, "destination": { ... }, "departureWindowStartDate": "2026-06-01T09:00:00.000Z" },
  "demandGroup": { "memberCount": 2, "totalPassengerCount": 3, "earliestDeparture": "2026-06-01T07:30:00.000Z", "origin": { ... }, "destination": { ... } }
}
```

> `route.*` reflects the live route record at call time — not a snapshot.
> `demandGroup` aggregates only `group_offers` with status `pending` or `accepted`; declined/closed/canceled offers are excluded.

### Driver search requests (Driver inbox)

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/drivers/search-requests/list` | `{ "driverId": "user-uuid", "statuses"?: [...] }` | List inbound search requests for a driver (hydrated). |
| POST | `/api/drivers/search-requests/accept` | `{ "id": "search-request-uuid" }` | Accept a search request. |
| POST | `/api/drivers/search-requests/decline` | `{ "id": "search-request-uuid" }` | Decline a search request. |

**List response** — each item includes hydrated fields:
```json
{
  "id": "sreq-...",
  "clientId": "...",
  "routeId": "...",
  "status": "pending",
  "counterparty": { "id": "...", "displayName": "Nguyễn Văn A", "avatarUrl": "...", "ratingAvg": 4.8, "tripCount": 12, "verificationStatus": "verified" },
  "route": { "origin": { ... }, "destination": { ... }, "departureWindowStartDate": "2026-06-01T09:00:00.000Z" },
  "plan": { "passengerCount": 2, "origin": { ... }, "destination": { ... } }
}
```

> Rows whose linked route or plan status is `completed` or `canceled` are excluded by the SQL query.
> `route.*` data is live (re-read each call), not snapshotted.

### Group offers (Client inbox)

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/clients/group-offers/list` | `{ "clientId": "user-uuid" }` | List a client's received group offers. |
| POST | `/api/clients/group-offers/accept` | `{ "id": "group-offer-uuid", "clientId": "user-uuid" }` | Accept a group offer (first-accept-wins). |
| POST | `/api/clients/group-offers/decline` | `{ "id": "group-offer-uuid", "clientId": "user-uuid" }` | Decline a group offer. |

Group offer statuses:

- `pending` — awaiting client response
- `accepted` — client accepted (route bound)
- `declined` — client declined explicitly, or auto-declined (sibling accepted, route taken, or unmatched trip canceled)
- `closed` — driver withdrew the group request (driver-side cancel)

### Client inbox

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/clients/inbox/list` | `{ "clientId": "user-uuid", "statuses"?: [...] }` | List client inbox items (hydrated). |

**Response** — UNION ALL of `group_offers` (direction: `incoming`) and `route_requests` (direction: `outgoing`), each including hydrated fields:
```json
{
  "id": "...",
  "source": "group_offer",
  "direction": "incoming",
  "clientId": "...",
  "routeId": "...",
  "driverId": "...",
  "planId": "plan-uuid",
  "status": "pending",
  "counterparty": { "id": "...", "displayName": "Trần B", "avatarUrl": "...", "ratingAvg": 4.5, "tripCount": 7, "verificationStatus": "verified" },
  "route": { "origin": { ... }, "destination": { ... }, "departureWindowStartDate": "2026-06-01T09:00:00.000Z" },
  "plan": { "passengerCount": 2 }
}
```

> Rows whose linked route or plan status is `completed` or `canceled` are excluded by the SQL query.
> `route.*` data is live (re-read each call), not snapshotted.
> `plan` is `null` when `planId` is null or the plan record cannot be loaded.

### Journeys and trips

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/journeys/get-summary` | `{ "tripId"?: "uuid", "routeId"?: "uuid", "planId"?: "uuid", "userId": "user-uuid" }` | Get shared journey summary with accepted counterpart. |
| POST | `/api/trips/cancel` | `{ "id": "trip-uuid", "userId": "user-uuid" }` | Cancel a trip/journey. |
| POST | `/api/trips/complete` | `{ "id": "trip-uuid", "userId": "user-uuid" }` | Mark the shared journey as completed. |

> Journey endpoints expose accepted shared state derived from route or client-plan records without path parameters.

### Saved locations

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/trips/saved-locations/list` | `{ "userId": "user-uuid" }` | List saved locations. |
| POST | `/api/trips/saved-locations/create` | `{ "userId", "name", "address", "location", ... }` | Create a saved location (max 10). |
| POST | `/api/trips/saved-locations/delete` | `{ "id": "saved-location-uuid", "userId": "user-uuid" }` | Delete a saved location. |

### Users

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/users/get` | `{ "id"?: "user-uuid", "mauid"?: "zalo-mauid" }` | Resolve an app user. |
| POST | `/api/users/update` | `{ "id": "user-uuid", ...fieldsToUpdate }` | Update user profile fields. |
| POST | `/api/users/mode/get` | `{ "userId": "user-uuid" }` | Read preferred mode. |
| POST | `/api/users/mode/update` | `{ "userId": "user-uuid", "preferredMode": "driver" | "client" }` | Save preferred mode. |
| POST | `/api/users/reviews/list` | `{ "userId": "user-uuid" }` | List reviews for a user. |
| POST | `/api/users/reports/list` | `{ "userId": "user-uuid" }` | List reports involving a user. |
| POST | `/api/users/blocked-users/list` | `{ "userId": "user-uuid" }` | List blocked users. |
| POST | `/api/users/blocked-users/create` | `{ "userId": "user-uuid", "blockedUserId": "user-uuid" }` | Block a user. |
| POST | `/api/users/blocked-users/delete` | `{ "userId": "user-uuid", "blockedUserId": "user-uuid" }` | Unblock a user. |
| POST | `/api/users/notifications/list` | `{ "userId": "user-uuid" }` | List notifications. |
| POST | `/api/users/notifications/create` | `{ "userId", "type", "title", "message", ... }` | Create a notification. |
| POST | `/api/users/notifications/read` | `{ "id": "notification-uuid", "userId": "user-uuid" }` | Mark one notification as read. |
| POST | `/api/users/notifications/read-all` | `{ "userId": "user-uuid" }` | Mark all notifications as read. |
| POST | `/api/reviews` | `{ "reviewerId", "revieweeId", "rating", "comment"? }` | Create a review. |
| POST | `/api/reports` | `{ "reporterId", "reportedUserId", "reason", "details"? }` | Create a report. |

**User response**: canonical user profile with backend UUID `id`, external `mauid`, display fields, and persisted mode/trust fields.

> **Identity model**: `users.id` is an internal UUID primary key. `users.mauid` is the external Zalo Mini App app-scoped identifier from `getUserID()`. All app-owned ownership fields (`ownerId`, `driverId`, `clientId`, and `userId`) reference backend UUID `id`, not `mauid`. `mauid` is preserved on user projections for Zalo-native actions like `openChat()`.

---

## Proxy and health carve-outs

### Zalo proxy endpoints

These endpoints remain `POST` and proxy Zalo APIs.

| Method | Path | Body shape | Description |
| ------ | ---- | ---------- | ----------- |
| POST | `/api/authorize` | `{ "code": "zalo-auth-code" }` | Exchange Zalo auth code for tokens. |
| POST | `/api/user-info` | `{ "accessToken": "token" }` | Get user profile via Zalo access token. |
| POST | `/api/phone-number` | `{ "accessToken": "token", "code": "phone-code" }` | Get phone number via Zalo token and code. |
| POST | `/api/location` | `{ "accessToken": "token", ... }` | Get location data via Zalo token. |

### vnmap proxy endpoints

These endpoints explicitly remain `GET` because they proxy map-provider request semantics.

| Method | Path | Query shape | Description |
| ------ | ---- | ----------- | ----------- |
| GET | `/api/vnmap/place/autocomplete` | `?input=...` | Proxy place autocomplete. |
| GET | `/api/vnmap/place/details` | `?placeId=...` | Proxy place details. |
| GET | `/api/vnmap/directions` | `?origin=...&destination=...` | Proxy directions. |

### Health

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Process health check. |

---

## Response Envelope

### Success envelope

Every application handler returns success as:

```json
{ "data": <payload> }
```

List/collection endpoints additionally carry a `meta` block with at least a `count`:

```json
{ "data": [ ... ], "meta": { "count": 3 } }
```

The HTTP status code expresses intent (`200` for reads/actions, `201` for resource creation, `204` reserved for no-content). The `meta` block is reserved for collection metadata (count today, cursors/links in the future).

### Error envelope

Every error response uses:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "issues": [ ... ], "details": <unknown> } }
```

- `code` is a stable machine-readable string. For `HttpError` thrown from controllers/services the global handler maps the HTTP status to `HTTP_<status>` (`HTTP_400`, `HTTP_404`, `HTTP_409`, `HTTP_500`). Validation failures from `validateSchema` emit `VALIDATION_ERROR`.
- `message` is a human-readable summary. For `500` responses the message is always the generic `"Internal server error"`; the underlying error is logged server-side.
- `issues` is present when the error carries per-field validation results (see "Validation Errors" below).
- `details` is optional and only appears when a service/controller explicitly opts in with `HttpError.withSafeDetails(...)` for a non-500 response. Plain `HttpError` payloads and all `500` responses omit `details` to avoid exposing internal state.

### Client compatibility note

The current Zalo Mini App consumes these endpoints directly. Adopting the envelope and RPC-style paths is a breaking API change. Coordinate backend and mobile deployments so clients call the POST action routes and read the envelope shapes together.

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

| Field | Type | Description |
| ----- | ---- | ----------- |
| `error.code` | string | Always `"VALIDATION_ERROR"` for validation failures. |
| `error.message` | string | Stable human-readable summary (`"Invalid request"`). |
| `error.issues` | array | One entry per failed rule from the underlying zod schema. |
| `error.issues[].path` | string[] | Dotted-path segments to the offending field (e.g. `["amountVnd"]`, `["body", "driverId"]`). |
| `error.issues[].message` | string | Per-rule human-readable message. |
| `error.issues[].code` | string | Stable zod issue code (`too_small`, `invalid_type`, `custom`, etc.). |

> Validation errors share the same envelope as domain errors (see "Response Envelope" above) — they simply use the `VALIDATION_ERROR` code and carry `issues`. Domain `HttpError` responses use `HTTP_<status>` codes and omit `issues`.

Schema-validated endpoint example:

| Method | Path | Body schema (`src/schemas/`) |
| ------ | ---- | ---------------------------- |
| POST | `/api/drivers/wallet/topups/create` | `driverWallet.ts` → `manualTopUpBodySchema` |

---

## Orchestration Rules

1. **First-accept-wins**: The first client to accept a group offer or the first driver to accept a search request wins the route.
2. **Sibling decline**: When a group offer or route request is accepted, all other pending sibling offers/requests on the same route or plan are auto-declined (`declined`).
3. **Route exclusivity**: One route can have only one accepted client (via group offer OR search request).
4. **Cross-flow blocking**: An accepted group offer blocks pending search requests for that route, and vice versa.
