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
const clientPlansRoute = require('./routes/clientPlans')
const usersRoute = require('./routes/users')
const demandGroupsRoute = require('./routes/demandGroups')
const driverMatchesRoute = require('./routes/driverMatches')
const clientMatchesRoute = require('./routes/clientMatches')
const journeysRoute = require('./routes/journeys')

// --- Phase 2 request orchestration routes ---
const groupRequestsRoute = require('./routes/groupRequests')
const groupOffersRoute = require('./routes/groupOffers')
const driverSearchRequestsRoute = require('./routes/driverSearchRequests')
const clientSearchRequestsRoute = require('./routes/clientSearchRequests')

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
app.use('/api', journeysRoute)
app.use('/api', usersRoute)

// --- Driver Namespace ---
app.use('/api/driver', carsRoute)
app.use('/api/driver', driverRoutesRoute)
app.use('/api/driver', groupRequestsRoute)
app.use('/api/driver', demandGroupsRoute)
app.use('/api/driver', driverMatchesRoute)
app.use('/api/driver', driverSearchRequestsRoute)

// --- Client Namespace ---
app.use('/api/client', clientPlansRoute)
app.use('/api/client', groupOffersRoute)
app.use('/api/client', clientMatchesRoute)
app.use('/api/client', clientSearchRequestsRoute)

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
const { checkConnection } = require('./db/connection')

async function start() {
  try {
    console.log('Connecting to Postgres...')
    await checkConnection()
    console.log('✓ Postgres connected')
  } catch (err) {
    console.error('⨯ Failed to connect to Postgres:', err.message)
    process.exit(1)
  }

  app.listen(PORT, () => {
    if (!process.env.ZALO_APP_ID) console.warn('⚠ ZALO_APP_ID is not set')
    if (!process.env.ZALO_APP_SECRET)
      console.warn('⚠ ZALO_APP_SECRET is not set')
    console.log(`✓ cung-tuyen-api listening on :${PORT}`)
  })
}

if (require.main === module) {
  start()
}

module.exports = app
