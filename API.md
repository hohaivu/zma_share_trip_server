# Cùng Tuyến — Phase 2 Server API

> Express.js demo server with in-memory state. All data resets on restart.

**Base URL**: `http://localhost:3010/api`

---

## Preserved Endpoints (Zalo Proxy)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| POST | `/authorize` | Exchange Zalo auth code for tokens | Unchanged |
| POST | `/user-info` | Get user profile via Zalo access token | Unchanged |
| POST | `/phone-number` | Get phone number via Zalo token + code | Unchanged |
| POST | `/location` | Get location data via Zalo token | Unchanged |

## Cars

| Method | Path | Description |
|--------|------|-------------|
| POST | `/cars` | Create a car. Body: `{ ownerId, plateNumberFull, brand, model, color, seatCapacity }` |
| GET | `/cars?ownerId=` | List cars by owner |
| PUT | `/cars/:id` | Update a car |
| DELETE | `/cars/:id` | Delete a car |

## Driver Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/routes` | Create route. Body: `{ driverId, carId, origin, destination, serviceDate, departureTime, tripPrice, ... }` |
| GET | `/routes?driverId=` | List routes by driver |
| GET | `/routes/:id` | Route detail |
| PUT | `/routes/:id` | Update route |

### Route Matching

| Method | Path | Description |
|--------|------|-------------|
| GET | `/routes/:id/matched-demand-groups` | Matched demand groups (exact_3/near_3, visibility, price) |
| GET | `/routes/:id/inbound-search-requests` | Pending/resolved search requests for this route |

## Client Trip Plans

| Method | Path | Description |
|--------|------|-------------|
| POST | `/trip-plans` | Create trip plan. Body: `{ clientId, pickup, dropoff, pickupWardId, dropoffWardId, serviceDate, departureBlockStart, departureBlockEnd, passengerCount, publishMode }` |
| GET | `/trip-plans?clientId=` | List trip plans by client |
| GET | `/trip-plans/:id` | Trip plan detail |
| PUT | `/trip-plans/:id` | Update trip plan |
| GET | `/trip-plans/:id/matching-routes` | Matching routes for `search_only` plans |

### publishMode Values

- `"grouped"` — joins a demand group for driver group requests
- `"search_only"` — client searches for routes directly

## User Mode Preference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/users/:id/mode` | Save preferred mode. Body: `{ preferredMode: "driver" \| "client" }` |
| GET | `/users/:id/mode` | Read preferred mode |

**Response**: `{ preferredMode, modeSelectedAt }`

## Demand Groups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/demand-groups/:id` | Group summary (serviceDate, wards, block, memberCount, totalPassengerCount) |
| GET | `/demand-groups/:id/members` | Member trip plans (exact-3 visibility only) |

> Demand groups are computed on-read from published `grouped` trip plans.
> Group ID format: `dg-{serviceDate}|{pickupWardId}|{dropoffWardId}|{departureBlockStart}`

## Group Requests (Driver → Group)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/group-requests` | Create group request + fan-out offers. Body: `{ driverId, routeId, demandGroupId, note? }` |
| GET | `/group-requests?driverId=` | List driver's sent group requests |
| POST | `/group-requests/:id/cancel` | Cancel group request + close pending offers |

**Response** (POST create): `{ groupRequest, offers: [...] }`

## Group Offers (Client Inbox)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/group-offers?clientId=` | Client's received group offers |
| POST | `/group-offers/:id/accept` | Accept group offer (first-accept-wins) |
| POST | `/group-offers/:id/decline` | Decline group offer |

### Group Offer Statuses

- `pending` — awaiting client response
- `accepted` — client accepted (route bound)
- `declined` — client declined
- `closed` — auto-closed (sibling won, request canceled, or route taken)

## Search Requests (Client → Route)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/search-requests` | Create search request. Body: `{ clientId, tripPlanId, routeId, note? }` |
| GET | `/search-requests?driverId=` | Driver's inbound search requests |
| GET | `/search-requests?clientId=` | Client's sent search requests |
| POST | `/search-requests/:id/accept` | Driver accepts search request |
| POST | `/search-requests/:id/decline` | Driver declines search request |

> Only `search_only` trip plans can create search requests.

## Trip Summary & Completion

| Method | Path | Description |
|--------|------|-------------|
| GET | `/trips/:id/summary` | Trip summary with accepted counterpart (route or trip plan ID) |
| POST | `/trips/:id/complete` | Mark trip as completed |

## Saved Locations (Deprecated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/trips/saved-locations` | List saved locations |
| POST | `/trips/saved-locations` | Create saved location (max 10) |
| DELETE | `/trips/saved-locations/:id` | Delete saved location |

---

## Removed Legacy Endpoints

| Legacy Path | Replacement |
|-------------|-------------|
| `POST /trips/demands` | `POST /trip-plans` |
| `GET /trips/demands?clientId=` | `GET /trip-plans?clientId=` |
| `PUT /trips/demands/:id` | `PUT /trip-plans/:id` |
| `POST /trips/routes` | `POST /routes` |
| `GET /trips/routes?driverId=` | `GET /routes?driverId=` |
| `PUT /trips/routes/:id` | `PUT /routes/:id` |
| `GET /matches?tripId=` | `GET /routes/:id/matched-demand-groups` or `GET /trip-plans/:id/matching-routes` |
| `POST /offers` | `POST /group-requests` or `POST /search-requests` |
| `POST /offers/:id/accept` | `POST /group-offers/:id/accept` or `POST /search-requests/:id/accept` |
| `POST /offers/:id/decline` | `POST /group-offers/:id/decline` or `POST /search-requests/:id/decline` |
| `GET /offers?driverId=` | `GET /group-requests?driverId=` or `GET /search-requests?driverId=` |
| `GET /offers?clientId=` | `GET /group-offers?clientId=` or `GET /search-requests?clientId=` |

## Removed Fields

| Field | Was On | Replacement |
|-------|--------|-------------|
| `availableSeats` | Route | Removed; seat capacity is on Car |
| `pricePerSeat` | Route, Offer | `tripPrice` (single number per route) |
| `seatCount` | Offer | Not applicable; single accepted client per route in MVP |
| `clientDemandId` | Match | Replaced by demand group and trip plan references |
| `shareableSeats` | Car | Removed from decision logic; `seatCapacity` retained |

---

## Orchestration Rules

1. **First-accept-wins**: The first client to accept a group offer or the first driver to accept a search request wins the route.
2. **Sibling closure**: When a group offer is accepted, all other pending offers from the same group request are auto-closed.
3. **Route exclusivity**: One route can have only one accepted client (via group offer OR search request).
4. **Cross-flow blocking**: An accepted group offer blocks pending search requests for that route, and vice versa.
5. **Mode isolation**: Only `search_only` trip plans can create search requests; `grouped` plans stay in grouped demand flow.
