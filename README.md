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

### App Ecosystem Namespaces

The trip matching capabilities are split across three distinct API namespaces based on resource ownership:

- **Shared (`/api/`)**: Base entities and journey lifecycle methods accessible by anyone. The stable `/api/trips/:id/summary` and `/api/trips/:id/complete` endpoints expose the accepted shared journey state while keeping route and plan drafts separate.
- **Driver (`/api/driver/`)**: Driver-owned operations (Cars, Routes, inbound Demand Groups, handling Client Search Requests, sending Group Requests).
- **Client (`/api/client/`)**: Client-owned operations (Trip Plans, viewing matching Routes, handling inbound Group Offers, sending Client Search Requests).

## Quick Start

```bash
cd zma_share_trip_server
cp .env.example .env   # fill in ZALO_APP_ID, ZALO_APP_SECRET, DATABASE_URL
yarn install
yarn db:migrate        # initialize Postgres schema
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
yarn db:migrate:dist   # run schema setup from the built artifact
yarn db:seed:dist      # seed demo data from the built artifact
yarn start             # serves dist/index.js
```

The build copies SQL migrations into `dist/db/migrations` so the compiled migration command stays runnable outside the source tree.

## Environment Variables

| Variable          | Required | Default | Description                                           |
| ----------------- | -------- | ------- | ----------------------------------------------------- |
| `DATABASE_URL`    | ✅       | —       | Postgres connection string                            |
| `ZALO_APP_ID`     | ✅       | —       | From [developers.zalo.me](https://developers.zalo.me) |
| `ZALO_APP_SECRET` | ✅       | —       | Secret key from app dashboard                         |
| `PORT`            | ❌       | `3010`  | Server port                                           |
| `ALLOWED_ORIGINS` | ❌       | `*`     | Comma-separated CORS origins                          |

## Deploy to Render

1. Push to GitHub/GitLab
2. Render Dashboard → **New** → **Blueprint**
3. Connect repo → Render reads `render.yaml`
4. Render installs with `yarn install --frozen-lockfile`, builds with `yarn build`, then runs `yarn db:migrate:dist` and `yarn db:seed:dist`
5. The web service starts from `node dist/index.js`
6. Set `ZALO_APP_ID` and `ZALO_APP_SECRET` in dashboard (Postgres connects automatically via Blueprint)
7. Deploy 🚀

## Test

```bash
# Health check
curl http://localhost:3010/health

# Shared route smoke test
curl http://localhost:3010/api/users/a1b2c3d4-0001-4000-8000-000000000001/mode
```
