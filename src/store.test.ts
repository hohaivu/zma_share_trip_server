import { describe, before, after, it as nodeIt } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, teardownTestDb, createDbTest } from './test-db';
import * as store from './store';
import * as matching from './matching';

const it = createDbTest('Postgres unavailable for DB-backed store tests');
const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const DRIVER_002_ID = 'a1b2c3d4-0002-4000-8000-000000000002'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'
const CLIENT_002_ID = 'a1b2c3d4-0004-4000-8000-000000000004'

// Note: require resets are not trivial in CJS, so we test against the shared
// store instance. Tests should not depend on ordering within a describe block.

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb()
})

// ─── 6.1 deriveDemandGroups ────────────────────────────────────────────────────

describe('deriveDemandGroups', () => {
  it('groups plans by serviceDate + ward pair + departure block', async () => {
    const groups = await store.deriveDemandGroups()
    // Seed has plan-001 and plan-002 sharing the same group key
    const q1TdGroup = groups.find(
      (g) =>
        g.pickupWardId === 'ward-q1-bennghe' &&
        g.dropoffWardId === 'ward-td-binhtho' &&
        g.serviceDate === '2030-03-20',
    )
    assert.ok(q1TdGroup, 'Should find Q1→TD group')
    assert.equal(q1TdGroup.memberCount, 2, 'Multi-member group')
    assert.equal(q1TdGroup.totalPassengerCount, 3, '1 + 2 passengers')
  })

  it('normalizes mixed timezone inputs into identical canonical UTC keys', async () => {
    // Both 14:00+07:00 and 07:00Z represent the same instant and must group together.
    const planA = await store.createPlan(CLIENT_001_ID, {
      pickup: { lat: 10, lng: 106, label: 'A' },
      dropoff: { lat: 11, lng: 106, label: 'B' },
      pickupWardId: 'ward-utc',
      dropoffWardId: 'ward-utc-dest',
      serviceDate: '2030-05-05',
      departureBlockStart: '2030-05-05T14:00:00.000+07:00', // mapped to 07:00Z
      departureBlockEnd: '2030-05-05T14:30:00.000+07:00',
      passengerCount: 1,
    })
    const planB = await store.createPlan(CLIENT_002_ID, {
      pickup: { lat: 10, lng: 106, label: 'A' },
      dropoff: { lat: 11, lng: 106, label: 'B' },
      pickupWardId: 'ward-utc',
      dropoffWardId: 'ward-utc-dest',
      serviceDate: '2030-05-05',
      departureBlockStart: '2030-05-05T07:00:00.000Z',
      departureBlockEnd: '2030-05-05T07:30:00.000Z',
      passengerCount: 2,
    })

    const groups = await store.deriveDemandGroups()
    const utcGroup = groups.find((g) => g.pickupWardId === 'ward-utc')
    assert.ok(utcGroup)
    assert.equal(
      utcGroup.memberCount,
      2,
      'Should group both plans into the same demand group despite different input strings',
    )
    assert.equal(
      utcGroup.departureBlockStart.endsWith('Z'),
      true,
      'Should use explicit canonical UTC Z-time on reads',
    )
  })



  it('creates single-member group for unique ward pair', async () => {
    const groups = await store.deriveDemandGroups()
    const tbGroup = groups.find((g) => g.pickupWardId === 'ward-tb-p15')
    assert.ok(tbGroup, 'Should find Tan Binh group')
    assert.equal(tbGroup.memberCount, 1, 'Single-member group')
    assert.equal(tbGroup.totalPassengerCount, 1)
  })
})

// ─── 6.2 exact-3 / near-3 classification ──────────────────────────────────────

describe('matching classification', () => {
  it('returns exact_3 for route matching demand group ward/block', async () => {
    const results = await matching.computeMatchedDemandGroups('route-001')
    const exact = results.filter((r) => r.matchTier === 'exact_3')
    assert.ok(exact.length > 0, 'Should have at least one exact_3 match')
  })

  it('returns results with tripPrice from route', async () => {
    const results = await matching.computeMatchedDemandGroups('route-001')
    for (const r of results) {
      assert.equal(r.tripPrice, 120000, 'Should carry route tripPrice')
    }
  })

  it('returns empty for non-existent route', async () => {
    const results = await matching.computeMatchedDemandGroups('route-999')
    assert.deepEqual(results, [])
  })
})

// ─── 6.3 visibility mode ──────────────────────────────────────────────────────

describe('computeVisibilityMode', () => {
  it('returns single_client_card for exact_3 + 1 member', async () => {
    assert.equal(
      await matching.computeVisibilityMode('exact_3', 1),
      'single_client_card',
    )
  })

  it('returns group_with_client_list for exact_3 + >1 members', async () => {
    assert.equal(
      await matching.computeVisibilityMode('exact_3', 3),
      'group_with_client_list',
    )
  })

  it('returns group_summary_only for near_3', async () => {
    assert.equal(
      await matching.computeVisibilityMode('near_3', 5),
      'group_summary_only',
    )
  })
})

// ─── 6.4 first-accept-wins ────────────────────────────────────────────────────

describe('first-accept-wins', () => {
  it('accepting one group offer closes siblings', async () => {
    // Create a group request to get offers
    await setupTestDb() // Reset DB to ensure fresh state for this complex test

    const groups = await store.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(multiMemberGroup, 'Need a multi-member group for this test')

    const result = await store.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
    )
    assert.ok(result.offers.length >= 2, 'Should fan out multiple offers')

    // Accept the first offer
    const winnerId = result.offers[0].id
    const accepted = await store.acceptGroupOffer(winnerId)
    assert.equal(accepted.status, 'accepted')

    // Check siblings are closed
    for (const offer of result.offers) {
      if (offer.id === winnerId) continue
      const clientOffers = await store.listGroupOffersByClient(offer.clientId)
      const sibling = clientOffers.find((o) => o.id === offer.id)
      assert.equal(sibling!.status, 'closed', 'Sibling should be closed')
    }
  })

  it('route becomes unavailable after acceptance', async () => {
    assert.equal(
      await store.isRouteAvailable('route-001'),
      false,
      'Route should be unavailable after acceptance',
    )
  })
})

// ─── 6.5 route exclusivity ────────────────────────────────────────────────────

describe('route exclusivity', () => {
  before(async () => {
    await setupTestDb()
    const groups = await store.deriveDemandGroups()
    const multiMemberGroup = groups.find((g) => g.memberCount > 1)
    assert.ok(multiMemberGroup, 'Need a multi-member group for exclusivity tests')

    const result = await store.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      multiMemberGroup.id,
    )
    await store.acceptGroupOffer(result.offers[0].id)
  })

  it('rejects new group requests for a route with accepted offer', async () => {
    const groups = await store.deriveDemandGroups()
    const group = groups[0]
    assert.ok(group)

    await assert.rejects(
      async () =>
        await store.createGroupRequest(DRIVER_002_ID, 'route-001', group.id),
      /not available/,
      'Should reject group request for unavailable route',
    )
  })

  it('rejects search request acceptance for unavailable route', async () => {
    assert.equal(await store.isRouteAvailable('route-001'), false)
    assert.equal(await store.isRouteAvailable('route-002'), true)
  })

  it('accepted search request blocks group offer acceptance', async () => {
    // Create a search request for route-002
    const sreq = await store.createSearchRequest(
      CLIENT_002_ID,
      'plan-004',
      'route-002',
    )
    assert.equal(sreq.status, 'pending')

    // Accept it
    const accepted = await store.acceptSearchRequest(sreq.id)
    assert.equal(accepted.status, 'accepted')
    assert.equal(await store.isRouteAvailable('route-002'), false)
  })
})

// ─── 6.6 search request plan linkage ──────────────────────────────────────────

describe('search request plan linkage', () => {
  before(async () => {
    await setupTestDb()
  })

  it('accepts grouped plan linkage when provided', async () => {
    const sreq = await store.createSearchRequest(
      CLIENT_001_ID,
      'plan-001',
      'route-002',
    )
    assert.equal(sreq.status, 'pending')
    assert.equal(sreq.planId, 'plan-001')
  })

  it('rejects unknown plan linkage', async () => {
    await assert.rejects(
      async () =>
        await store.createSearchRequest(
          CLIENT_001_ID,
          'plan-missing',
          'route-002',
        ),
      /Plan not found/,
      'Unknown planId should fail validation',
    )
  })

  it('accepts ad hoc search requests without plan linkage', async () => {
    const sreq = await store.createSearchRequest(
      CLIENT_001_ID,
      null,
      'route-002',
    )
    assert.equal(sreq.status, 'pending')
    assert.equal(sreq.planId, null)
  })

})

// ─── 6.7 CRUD coverage ────────────────────────────────────────────────────────

describe('CRUD operations', () => {
  it('users CRUD behaves correctly', async () => {
    const user = await store.getUser(DRIVER_001_ID)
    assert.ok(user)
    assert.equal(user.displayName, 'Tài xế 001')

    const updated = await store.setUserMode(DRIVER_001_ID, 'client')
    assert.equal(updated!.preferredMode, 'client')
    assert.ok(updated!.modeSelectedAt)

    const mode = await store.getUserMode(DRIVER_001_ID)
    assert.equal(mode!.preferredMode, 'client')
  })

  it('cars CRUD behaves correctly', async () => {
    const car = await store.createCar(DRIVER_001_ID, {
      plateNumberFull: '12A-12345',
      plateNumberMasked: '12A***45',
      brand: 'Test',
      model: 'Car',
      color: 'Red',
      seatCapacity: 4,
      verificationStatus: 'unverified',
      photos: [],
    })

    assert.ok(car.id)

    const cars = await store.listCarsByOwner(DRIVER_001_ID)
    assert.ok(cars.find((c) => c.id === car.id))

    const updated = await store.updateCar(car.id, { color: 'Blue' })
    assert.equal(updated!.color, 'Blue')

    const deleted = await store.deleteCar(car.id)
    assert.ok(deleted)
  })
})
