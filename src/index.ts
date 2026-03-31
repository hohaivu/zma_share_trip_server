import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';

import zaloRoutesRoute from './routes/zaloRoutes';
import carsRoute from './routes/cars';
import driverRoutesRoute from './routes/driverRoutes';
import clientPlansRoute from './routes/clientPlans';
import usersRoute from './routes/users';
import bootstrapRoute from './routes/bootstrap';
import demandGroupsRoute from './routes/demandGroups';
import driverMatchesRoute from './routes/driverMatches';
import clientMatchesRoute from './routes/clientMatches';
import journeysRoute from './routes/journeys';
import groupRequestsRoute from './routes/groupRequests';
import groupOffersRoute from './routes/groupOffers';
import driverSearchRequestsRoute from './routes/driverSearchRequests';
import clientSearchRequestsRoute from './routes/clientSearchRequests';
import { checkConnection } from './db/connection';

const app: Express = express();
const PORT = process.env.PORT || 3010;

app.use(express.json());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : '*',
  })
);

const sharedRoutes = [
  zaloRoutesRoute,
  journeysRoute,
  usersRoute,
  bootstrapRoute,
];

const driverRoutes = [
  carsRoute,
  driverRoutesRoute,
  groupRequestsRoute,
  demandGroupsRoute,
  driverMatchesRoute,
  driverSearchRequestsRoute,
];

const clientRoutes = [
  clientPlansRoute,
  groupOffersRoute,
  clientMatchesRoute,
  clientSearchRequestsRoute,
];

for (const route of sharedRoutes) app.use('/api', route);
for (const route of driverRoutes) app.use('/api/driver', route);
for (const route of clientRoutes) app.use('/api/client', route);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server error]', err);
  res.status(500).json({ error: -1, message: 'Internal server error' });
});

async function start() {
  try {
    console.log('Connecting to Postgres...');
    await checkConnection();
    console.log('✓ Postgres connected');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('⨯ Failed to connect to Postgres:', message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    if (!process.env.ZALO_APP_ID) console.warn('⚠ ZALO_APP_ID is not set');
    if (!process.env.ZALO_APP_SECRET)
      console.warn('⚠ ZALO_APP_SECRET is not set');
    console.log(`✓ cung-tuyen-api listening on :${PORT}`);
  });
}

if (require.main === module) {
  start();
}

export default app;
