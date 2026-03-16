# Cùng Tuyến — API Server

Stateless proxy that exchanges Zalo Mini App tokens for user data via the Zalo Open API.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/authorize` | Validate access token, return user profile |
| POST | `/api/user-info` | Get user profile from access token |
| POST | `/api/phone-number` | Exchange phone token → phone number |
| POST | `/api/location` | Exchange location token → GPS coords |
| GET | `/health` | Server health check |

## Quick Start

```bash
cd server
cp .env.example .env   # fill in ZALO_APP_ID, ZALO_APP_SECRET
npm install
npm run dev
```

Server starts at `http://localhost:3000`.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZALO_APP_ID` | ✅ | — | From [developers.zalo.me](https://developers.zalo.me) |
| `ZALO_APP_SECRET` | ✅ | — | Secret key from app dashboard |
| `PORT` | ❌ | `3000` | Server port |
| `ALLOWED_ORIGINS` | ❌ | `*` | Comma-separated CORS origins |

## Deploy to Render

1. Push to GitHub/GitLab
2. Render Dashboard → **New** → **Blueprint**
3. Connect repo → Render reads `render.yaml`
4. Set `ZALO_APP_ID` and `ZALO_APP_SECRET` in dashboard
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
