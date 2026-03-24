require('dotenv').config()
const express = require('express')
const cors = require('cors')

// --- Zalo proxy routes (unchanged) ---
const authorizeRoute = require('./routes/authorize')
const userInfoRoute = require('./routes/userInfo')
const phoneNumberRoute = require('./routes/phoneNumber')
const locationRoute = require('./routes/location')

// --- Preserved routes ---
const carsRoute = require('./routes/cars')

// --- Phase 2 resource routes ---
const driverRoutesRoute = require('./routes/driverRoutes')
const tripPlansRoute = require('./routes/tripPlans')
const usersRoute = require('./routes/users')
const demandGroupsRoute = require('./routes/demandGroups')
const matchesRoute = require('./routes/matches')
const tripsRoute = require('./routes/trips')

// --- Phase 2 request orchestration routes ---
const groupRequestsRoute = require('./routes/groupRequests')
const groupOffersRoute = require('./routes/groupOffers')
const searchRequestsRoute = require('./routes/searchRequests')

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

// --- Zalo proxy routes ---
app.use('/api', authorizeRoute)
app.use('/api', userInfoRoute)
app.use('/api', phoneNumberRoute)
app.use('/api', locationRoute)

// --- Preserved routes ---
app.use('/api', carsRoute)

// --- Phase 2 resource routes ---
app.use('/api', driverRoutesRoute)
app.use('/api', tripPlansRoute)
app.use('/api', usersRoute)
app.use('/api', demandGroupsRoute)
app.use('/api', matchesRoute)
app.use('/api', tripsRoute)

// --- Phase 2 request orchestration routes ---
app.use('/api', groupRequestsRoute)
app.use('/api', groupOffersRoute)
app.use('/api', searchRequestsRoute)

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
