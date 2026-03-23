require('dotenv').config()
const express = require('express')
const cors = require('cors')

const authorizeRoute = require('./routes/authorize')
const userInfoRoute = require('./routes/userInfo')
const phoneNumberRoute = require('./routes/phoneNumber')
const locationRoute = require('./routes/location')
const carsRoute = require('./routes/cars')
const tripsRoute = require('./routes/trips')
const matchesRoute = require('./routes/matches')
const offersRoute = require('./routes/offers')

const app = express()
const PORT = process.env.PORT || 3010

// --- Middleware ---
app.use(express.json())
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : '*',
  }),
)

// --- Routes ---
app.use('/api', authorizeRoute)
app.use('/api', userInfoRoute)
app.use('/api', phoneNumberRoute)
app.use('/api', locationRoute)
app.use('/api', carsRoute)
app.use('/api', tripsRoute)
app.use('/api', matchesRoute)
app.use('/api', offersRoute)

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// --- Global error handler ---
app.use((err, _req, res, _next) => {
  console.error('[server error]', err)
  res.status(500).json({ error: -1, message: 'Internal server error' })
})

// --- Startup ---
app.listen(PORT, () => {
  if (!process.env.ZALO_APP_ID) console.warn('⚠ ZALO_APP_ID is not set')
  if (!process.env.ZALO_APP_SECRET) console.warn('⚠ ZALO_APP_SECRET is not set')
  console.log(`✓ cung-tuyen-api listening on :${PORT}`)
})
