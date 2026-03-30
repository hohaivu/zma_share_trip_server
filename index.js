require('dotenv').config()
const express = require('express')
const cors = require('cors')

const zaloRoutesRoute = require('./routes/zaloRoutes')
const carsRoute = require('./routes/cars')
const driverRoutesRoute = require('./routes/driverRoutes')
const clientPlansRoute = require('./routes/clientPlans')
const usersRoute = require('./routes/users')
const bootstrapRoute = require('./routes/bootstrap')
const demandGroupsRoute = require('./routes/demandGroups')
const driverMatchesRoute = require('./routes/driverMatches')
const clientMatchesRoute = require('./routes/clientMatches')
const journeysRoute = require('./routes/journeys')
const groupRequestsRoute = require('./routes/groupRequests')
const groupOffersRoute = require('./routes/groupOffers')
const driverSearchRequestsRoute = require('./routes/driverSearchRequests')
const clientSearchRequestsRoute = require('./routes/clientSearchRequests')
const { checkConnection } = require('./db/connection')

const app = express()
const PORT = process.env.PORT || 3010

app.use(express.json())
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : '*',
  }),
)

const sharedRoutes = [
  zaloRoutesRoute,
  journeysRoute,
  usersRoute,
  bootstrapRoute,
]

const driverRoutes = [
  carsRoute,
  driverRoutesRoute,
  groupRequestsRoute,
  demandGroupsRoute,
  driverMatchesRoute,
  driverSearchRequestsRoute,
]

const clientRoutes = [
  clientPlansRoute,
  groupOffersRoute,
  clientMatchesRoute,
  clientSearchRequestsRoute,
]

for (const route of sharedRoutes) app.use('/api', route)
for (const route of driverRoutes) app.use('/api/driver', route)
for (const route of clientRoutes) app.use('/api/client', route)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use((err, _req, res, _next) => {
  console.error('[server error]', err)
  res.status(500).json({ error: -1, message: 'Internal server error' })
})

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
