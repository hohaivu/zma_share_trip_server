import assert from 'node:assert/strict'
import { after, before, describe, it as nodeIt } from 'node:test'

import { query } from './db/connection'
import * as matching from './matching'
import * as carService from './services/carService'
import * as driverRouteRepository from './repositories/driverRouteRepository'
import * as driverRouteService from './services/driverRouteService'
import * as groupOfferService from './services/groupOfferService'
import * as groupRequestRepository from './repositories/groupRequestRepository'
import * as groupRequestService from './services/groupRequestService'
import * as journeyRepository from './repositories/journeyRepository'
import * as planService from './services/planService'
import * as routeRequestService from './services/routeRequestService'
import * as userService from './services/userService'
import * as walletService from './services/walletService'
import {
  createDbTest,
  isDbAvailable,
  setupTestDb,
  teardownTestDb,
} from './test-db'
import { Plan, Route } from './types/entities'

const it = createDbTest('Postgres unavailable for DB-backed MVC module tests')
const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const DRIVER_002_ID = 'a1b2c3d4-0002-4000-8000-000000000002'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'
const CLIENT_002_ID = 'a1b2c3d4-0004-4000-8000-000000000004'
const TERMINAL_SEARCH_REQUEST_STATUSES = [
  'declined',
  'closed',
  'expired',
] as const

// Note: require resets are not trivial in CJS, so tests use the shared
// MVC module graph. Tests should not depend on ordering within a describe block.

before(async () => {
  await setupTestDb()
})

after(async () => {
  await teardownTestDb()
})

// ─── 6.1 deriveDemandGroups ────────────────────────────────────────────────────


describe('MVC user service notifications, reviews, reports, and blocks', () => {
  it('persists notification lifecycle through the user service seam', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const notification = await userService.createNotification({
      recipientId: CLIENT_001_ID,
      type: 'request_received',
      title: 'MVC notification',
      body: 'A route request was received.',
      targetRoute: '/requests',
      deepLink: '/requests/1',
      requestSource: 'route_request',
      metadata: { routeRequestId: 'request-001' },
    })

    const unread = await userService.listNotifications(CLIENT_001_ID)
    assert.equal(unread[0]?.id, notification.id)
    assert.equal(unread[0]?.read, false)

    const read = await userService.markNotificationRead(
      CLIENT_001_ID,
      notification.id,
    )
    assert.equal(read?.read, true)

    const second = await userService.createNotification({
      recipientId: CLIENT_001_ID,
      type: 'request_closed',
      title: 'Closed',
      body: 'The request closed.',
    })
    await userService.markAllNotificationsRead(CLIENT_001_ID)
    const allRead = await userService.listNotifications(CLIENT_001_ID)
    assert.equal(allRead.find((item) => item.id === second.id)?.read, true)
  })

  it('persists review and report records through user service facades', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    await query(
      "INSERT INTO route_requests (id, client_id, plan_id, route_id, driver_id, trip_price, status, created_at) VALUES ('review-rr-001', $1, 'plan-001', 'route-001', $2, 100000, 'accepted', NOW()) ON CONFLICT (id) DO NOTHING",
      [CLIENT_001_ID, DRIVER_001_ID],
    )
    await query(
      "UPDATE routes SET status = 'completed', completed_at = NOW() WHERE id = 'route-001'",
    )

    const review = await userService.createReview({
      tripId: 'route-001',
      reviewerId: CLIENT_001_ID,
      revieweeId: DRIVER_001_ID,
      rating: 5,
      comment: 'Great MVC trip',
    })
    const report = await userService.createReport({
      tripId: 'route-001',
      reporterId: CLIENT_001_ID,
      reporteeId: DRIVER_001_ID,
      reason: 'unsafe_behavior',
      detail: 'MVC report detail',
    })

    assert.equal(
      (await userService.listReviewsByReviewer(CLIENT_001_ID)).some(
        (item) => item.id === review.id,
      ),
      true,
    )
    assert.equal(
      (await userService.listReportsByReporter(CLIENT_001_ID)).some(
        (item) => item.id === report.id,
      ),
      true,
    )
  })

  it('maintains block and unblock state through user service facades', async () => {
    await setupTestDb()
    if (!isDbAvailable()) return

    const blocked = await userService.blockUser(CLIENT_001_ID, DRIVER_001_ID)
    assert.equal(blocked.includes(DRIVER_001_ID), true)
    assert.equal(
      (await userService.getBlockedUsers(CLIENT_001_ID)).includes(DRIVER_001_ID),
      true,
    )

    const unblocked = await userService.unblockUser(CLIENT_001_ID, DRIVER_001_ID)
    assert.equal(unblocked.includes(DRIVER_001_ID), false)
  })
})
