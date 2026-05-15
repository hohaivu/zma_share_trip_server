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

Wave 0 of ALI-37 defines the shared MVC rules for upcoming route/controller/service/repository refactor work. See [`docs/mvc-contract.md`](docs/mvc-contract.md) before adding or moving endpoints.

New endpoints should be wired in `src/routes`, orchestrated through `src/controllers`, implemented in `src/services`, and use `src/repositories` for persistence access when needed. Keep imports flowing top-down (`routes -> controllers -> services -> repositories`) and preserve existing API response shapes unless `API.md` is updated as part of a coordinated API change.

ALI-37 is not complete in Wave 0: automated import guardrails, lint/test/script checks, and source refactors are explicitly pending future closing work.

## Quick Start

```bash
cd zma_share_trip_server
cp .env.example .env   # fill in ZALO_APP_ID, ZALO_APP_SECRET, VNMAP_API_KEY, DATABASE_URL
yarn install
yarn db:schema        # initialize Postgres schema
yarn db:seed           # insert demo data
yarn dev
```

Server starts at `http://localhost:3010`.

## Validation

```bash
yarn typecheck
yarn test
yarn build
```

## Production-Style Artifact Workflow

```bash
yarn build
yarn db:schema:dist   # run schema setup from the built artifact
yarn db:seed:dist      # seed demo data from the built artifact
yarn start:dist        # serves dist/index.js
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
