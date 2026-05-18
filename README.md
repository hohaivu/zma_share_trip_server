# Cùng Tuyến — API Server

TypeScript-authored Express API backed by Postgres for bootstrap, matching, trip lifecycle, and Zalo exchange flows.

## Endpoints

| Method | Path                | Description                                |
| ------ | ------------------- | ------------------------------------------ |
| GET    | `/health`           | Server health check                        |
| POST   | `/api/authorize`    | Validate access token, return user profile |
| POST   | `/api/user-info`    | Get user profile from access token         |
| POST   | `/api/phone-number` | Exchange phone token → phone number        |
| POST   | `/api/location`     | Exchange location token → GPS coords       |
| GET    | `/api/vnmap/place/autocomplete` | Proxy VNMap autocomplete      |
| GET    | `/api/vnmap/place/details`      | Proxy VNMap place detail       |
| GET    | `/api/vnmap/directions`         | Proxy VNMap directions         |

### App Ecosystem Namespaces

The trip matching capabilities are split across three distinct API namespaces based on resource ownership:

- **Shared (`/api/`)**: Base entities and journey lifecycle methods accessible by anyone. The stable `/api/trips/:id/summary` and `/api/trips/:id/complete` endpoints expose the accepted shared journey state while keeping route and plan drafts separate.
- **Driver (`/api/driver/`)**: Driver-owned operations (Cars, Routes, inbound Demand Groups, handling Client Search Requests, sending Group Requests).
- **Client (`/api/client/`)**: Client-owned operations (Trip Plans, viewing matching Routes, handling inbound Group Offers, sending Client Search Requests).


## MVC Architecture Contract

ALI-37 defines the shared MVC rules for route/controller/service/repository refactor work. See [`docs/mvc-contract.md`](docs/mvc-contract.md) before adding or moving endpoints.

New endpoints should be wired in `src/routes`, orchestrated through `src/controllers`, implemented in `src/services`, and use `src/repositories` for persistence access when needed. Keep imports flowing top-down (`routes -> controllers -> services -> repositories`) and preserve existing API response shapes unless `API.md` is updated as part of a coordinated API change.

Run `npm run mvc:guardrails` after adding or moving endpoint code. The guardrail fails when files under `src/routes` or `src/controllers` import the shared store directly; route/controller code should go through a service or repository boundary instead.

ALI-37 is not complete: broader source refactors and full dependency-direction enforcement remain future closing work.

## Quick Start

```bash
cd zma_share_trip_server
cp .env.example .env   # fill in ZALO_APP_ID, ZALO_APP_SECRET, VNMAP_API_KEY, DATABASE_URL
npm install
npm run db:schema        # initialize Postgres schema
npm run db:seed           # insert demo data
npm run dev
```

Server starts at `http://localhost:3010`.

## Validation

```bash
npm run typecheck
npm run mvc:guardrails
npm test
npm run build
```

### Local Docker Test Database

DB-backed tests skip automatically when Postgres is unavailable. To run them against a dedicated local test database, start the Docker Postgres service on host port `5433` and use the test DB script:

```bash
npm run test:db:up
npm run test:db
npm run test:db:down
```

The `test:db` script sets `DATABASE_URL=postgres://postgres:postgres@localhost:5433/share_trip_db` for the test process. The default `npm test` command is unchanged and remains suitable when you want the existing environment/default behavior.

## Production-Style Artifact Workflow

```bash
npm run build
npm run db:schema:dist   # run schema setup from the built artifact
npm run db:seed:dist      # seed demo data from the built artifact
npm run start:dist        # serves dist/index.js
```

The build copies `src/db/schema.sql` into `dist/db/schema.sql` so the compiled schema setup command stays runnable outside the source tree.

## Environment Variables

| Variable          | Required | Default | Description                                           |
| ----------------- | -------- | ------- | ----------------------------------------------------- |
| `DATABASE_URL`    | ✅       | —       | Postgres connection string                            |
| `ZALO_APP_ID`     | ✅       | —       | From [developers.zalo.me](https://developers.zalo.me) |
| `ZALO_APP_SECRET` | ✅       | —       | Secret key from app dashboard                         |
| `VNMAP_API_KEY`   | ✅       | —       | VNMap provider key used only by backend proxy         |
| `PORT`            | ❌       | `3010`  | Server port                                           |
| `ALLOWED_ORIGINS` | ❌       | `*`     | Comma-separated CORS origins                          |

For local Docker-backed tests, use `postgres://postgres:postgres@localhost:5433/share_trip_db`; see `docker-compose.test.yml` and `npm run test:db`.

## Deploy to Render

1. Push to GitHub/GitLab
2. Render Dashboard → **New** → **Blueprint**
3. Connect repo → Render reads `render.yaml`
4. Render installs with `npm install`, then runs `npm run db:schema` and `npm run db:seed`
5. The web service starts from `npm start`
6. Set `ZALO_APP_ID`, `ZALO_APP_SECRET`, and `VNMAP_API_KEY` in dashboard (Postgres connects automatically via Blueprint)
7. Deploy 🚀

This deploy path runs the TypeScript source directly through `tsx`, so it does not require a separate build step on Render.

If you create a manual Node service instead of a Blueprint, use the same commands:

```bash
npm install && npm run db:schema && npm run db:seed
```

and keep the start command as `npm start`. The package `start` script runs via `tsx`, so it does not require a separate build step.

## Test

```bash
# Health check
curl http://localhost:3010/health

# Shared route smoke test
curl http://localhost:3010/api/users/a1b2c3d4-0001-4000-8000-000000000001/mode
```
