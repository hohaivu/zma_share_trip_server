import cors from 'cors'
import 'dotenv/config'
import express, { Express, NextFunction, Request, Response } from 'express'

import { checkConnection } from './db/connection'
import { HttpError } from './http-error'
import bootstrapRoute from './routes/bootstrap'
import carsRoute from './routes/cars'
import clientMatchesRoute from './routes/clientMatches'
import clientPlansRoute from './routes/clientPlans'
import clientSearchRequestsRoute from './routes/clientSearchRequests'
import demandGroupsRoute from './routes/demandGroups'
import driverMatchesRoute from './routes/driverMatches'
import driverRoutesRoute from './routes/driverRoutes'
import driverWalletRoute from './routes/driverWallet'
import driverSearchRequestsRoute from './routes/driverSearchRequests'
import groupOffersRoute from './routes/groupOffers'
import groupRequestsRoute from './routes/groupRequests'
import journeysRoute from './routes/journeys'
import usersRoute from './routes/users'
import zaloRoutesRoute from './routes/zaloRoutes'

const app: Express = express()
const PORT = process.env.PORT || 3010

app.use(express.json())
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
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
  driverWalletRoute,
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

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.statusCode : 500
  const message = status === 500 ? 'Internal server error' : err.message
  if (status === 500) console.error('[server error]', err)
  res.status(status).json({ error: -1, message })
})

async function start() {
  try {
    console.log('Connecting to Postgres...')
    await checkConnection()
    console.log('✓ Postgres connected')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('⨯ Failed to connect to Postgres:', message)
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

export default app
