# Cùng Tuyến — API Server

Stateless proxy that exchanges Zalo Mini App tokens for user data via the Zalo Open API.

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
npm install
npm run db:migrate     # initialize Postgres schema
npm run db:seed        # insert demo data
npm run dev
```

Server starts at `http://localhost:3010`.

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
4. Set `ZALO_APP_ID` and `ZALO_APP_SECRET` in dashboard (Postgres connects automatically via Blueprint)
5. Deploy 🚀

## Test

```bash
# Health check
curl http://localhost:3000/health

# Authorize (requires real token)
curl -X POST http://localhost:3000/api/authorize \
  -H "Content-Type: application/json" \
  -d '{"accessToken": "YOUR_TOKEN"}'
```
