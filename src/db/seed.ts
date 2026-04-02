import { Location, Plan, Route, User } from '../types/entities'
import { closePool, initPool } from './connection'

// --- Named constants ---

const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const DRIVER_002_ID = 'a1b2c3d4-0002-4000-8000-000000000002'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'
const CLIENT_002_ID = 'a1b2c3d4-0004-4000-8000-000000000004'

const SERVICE_DATE_MAR20 = '2030-03-20'
const SERVICE_DATE_MAR21 = '2030-03-21'

const COORD_Q1 = { lat: 10.7769, lng: 106.7009, label: 'Quận 1' }
const COORD_TD = { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' }
const COORD_Q1_NEAR = { lat: 10.778, lng: 106.702, label: 'Quận 1' }
const COORD_TD_NEAR = { lat: 10.855, lng: 106.754, label: 'Thủ Đức' }
const COORD_TB = { lat: 10.8, lng: 106.65, label: 'Tân Bình' }
const COORD_TD_TB = { lat: 10.85, lng: 106.76, label: 'Thủ Đức' }

const WARD_Q1 = 'ward-q1-bennghe'
const WARD_TD = 'ward-td-binhtho'
const WARD_KEY_Q1 = 'ward-q1-bennghe_79'
const WARD_KEY_TD = 'ward-td-binhtho_79'
const PROVINCE_HCM = '79'

interface SeedUser extends Omit<User, 'createdAt' | 'modeSelectedAt'> {
  createdAt: string
  modeSelectedAt: string
}

interface SeedRoute {
  id: string
  driverId: string
  carId: string
  origin: Location
  destination: Location
  originWardId: string
  originWardKey: string
  originProvinceId: string
  destinationWardId: string
  destinationWardKey: string
  destinationProvinceId: string
  serviceDate: string
  departureTime: string
  windowStart: string
  windowEnd: string
  tripPrice: number
  notes: string
  status: string
  createdAt: string
}

interface SeedPlan {
  id: string
  clientId: string
  pickup: Location
  dropoff: Location
  pickupWardId: string
  pickupWardKey: string
  pickupProvinceId: string
  dropoffWardId: string
  dropoffWardKey: string
  dropoffProvinceId: string
  serviceDate: string
  departureBlockStart: string
  departureBlockEnd: string
  passengerCount: number
  notes: string
  status: string
  createdAt: string
}

// --- Factory helpers ---

function makeUser(
  overrides: Partial<SeedUser> &
    Pick<
      SeedUser,
      | 'id'
      | 'mauid'
      | 'displayName'
      | 'role'
      | 'preferredMode'
      | 'modeSelectedAt'
      | 'createdAt'
    >,
): SeedUser {
  return {
    avatarUrl: '',
    verificationStatus: 'verified',
    ratingAvg: 4.5,
    tripCount: 0,
    blockedUserIds: [],
    ...overrides,
  } as SeedUser
}

function makeRoute(
  overrides: Partial<SeedRoute> &
    Pick<
      SeedRoute,
      | 'id'
      | 'driverId'
      | 'carId'
      | 'serviceDate'
      | 'departureTime'
      | 'windowStart'
      | 'windowEnd'
      | 'tripPrice'
      | 'createdAt'
    >,
): SeedRoute {
  return {
    origin: COORD_Q1,
    destination: COORD_TD,
    originWardId: WARD_Q1,
    originWardKey: WARD_KEY_Q1,
    originProvinceId: PROVINCE_HCM,
    destinationWardId: WARD_TD,
    destinationWardKey: WARD_KEY_TD,
    destinationProvinceId: PROVINCE_HCM,
    notes: '',
    status: 'published',
    ...overrides,
  }
}

function makePlan(
  overrides: Partial<SeedPlan> &
    Pick<
      SeedPlan,
      | 'id'
      | 'clientId'
      | 'serviceDate'
      | 'departureBlockStart'
      | 'departureBlockEnd'
      | 'createdAt'
    >,
): SeedPlan {
  return {
    pickup: COORD_Q1,
    dropoff: COORD_TD,
    pickupWardId: WARD_Q1,
    dropoffWardId: WARD_TD,
    pickupWardKey: WARD_KEY_Q1,
    dropoffWardKey: WARD_KEY_TD,
    pickupProvinceId: PROVINCE_HCM,
    dropoffProvinceId: PROVINCE_HCM,
    passengerCount: 1,
    notes: '',
    status: 'published',
    ...overrides,
  }
}

// --- Seed data ---

// Deterministic UUIDs for reproducible demo/dev seeding.
// mauid values represent external Zalo Mini App identifiers.
const users = [
  makeUser({
    id: DRIVER_001_ID,
    mauid: 'zalo-driver-001',
    displayName: 'Tài xế 001',
    ratingAvg: 4.8,
    tripCount: 112,
    role: 'driver',
    preferredMode: 'driver',
    modeSelectedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }),
  makeUser({
    id: DRIVER_002_ID,
    mauid: 'zalo-driver-002',
    displayName: 'Tài xế 002',
    ratingAvg: 4.5,
    tripCount: 45,
    role: 'driver',
    preferredMode: 'driver',
    modeSelectedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
  }),
  makeUser({
    id: CLIENT_001_ID,
    mauid: 'zalo-client-001',
    displayName: 'Hành khách 001',
    ratingAvg: 4.7,
    tripCount: 52,
    role: 'client',
    preferredMode: 'client',
    modeSelectedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }),
  makeUser({
    id: CLIENT_002_ID,
    mauid: 'zalo-client-002',
    displayName: 'Hành khách 002',
    ratingAvg: 4.9,
    tripCount: 30,
    role: 'client',
    preferredMode: 'client',
    modeSelectedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
  }),
]

const cars = [
  {
    id: 'car-001',
    ownerId: DRIVER_001_ID,
    nickname: 'Xe gia đình',
    plateNumberMasked: '51A-***45',
    plateNumberFull: '51A-123.45',
    brand: 'Toyota',
    model: 'Vios',
    color: '#FFFFFF',
    seatCapacity: 5,
    verificationStatus: 'verified',
    photos: [],
    createdAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'car-002',
    ownerId: DRIVER_002_ID,
    nickname: 'Xe đi làm',
    plateNumberMasked: '59C-***78',
    plateNumberFull: '59C-456.78',
    brand: 'Honda',
    model: 'City',
    color: '#1A1A1A',
    seatCapacity: 5,
    verificationStatus: 'verified',
    photos: [],
    createdAt: '2026-01-04T00:00:00.000Z',
  },
]

const routes = [
  makeRoute({
    id: 'route-001',
    driverId: DRIVER_001_ID,
    carId: 'car-001',
    serviceDate: SERVICE_DATE_MAR20,
    departureTime: '2030-03-20T00:00:00.000Z', // 07:00 local
    windowStart: '2030-03-19T23:45:00.000Z', // 06:45 local
    windowEnd: '2030-03-20T00:15:00.000Z', // 07:15 local
    tripPrice: 120000,
    createdAt: '2026-01-05T00:00:00.000Z',
  }),
  makeRoute({
    id: 'route-002',
    driverId: DRIVER_002_ID,
    carId: 'car-002',
    serviceDate: SERVICE_DATE_MAR20,
    departureTime: '2030-03-20T00:30:00.000Z',
    windowStart: '2030-03-20T00:15:00.000Z',
    windowEnd: '2030-03-20T00:45:00.000Z',
    tripPrice: 100000,
    createdAt: '2026-01-05T00:00:00.000Z',
  }),
]

const plans = [
  makePlan({
    id: 'plan-001',
    clientId: CLIENT_001_ID,
    serviceDate: SERVICE_DATE_MAR20,
    departureBlockStart: '2030-03-20T00:00:00.000Z',
    departureBlockEnd: '2030-03-20T00:30:00.000Z',
    createdAt: '2026-01-05T00:00:00.000Z',
  }),
  makePlan({
    id: 'plan-002',
    clientId: CLIENT_002_ID,
    pickup: COORD_Q1_NEAR,
    dropoff: COORD_TD_NEAR,
    serviceDate: SERVICE_DATE_MAR20,
    departureBlockStart: '2030-03-20T00:00:00.000Z',
    departureBlockEnd: '2030-03-20T00:30:00.000Z',
    passengerCount: 2,
    createdAt: '2026-01-05T01:00:00.000Z',
  }),
  makePlan({
    id: 'plan-003',
    clientId: CLIENT_001_ID,
    pickup: COORD_TB,
    dropoff: COORD_TD_TB,
    pickupWardId: 'ward-tb-p15',
    pickupWardKey: 'ward-tb-p15_79',
    serviceDate: SERVICE_DATE_MAR20,
    departureBlockStart: '2030-03-20T00:00:00.000Z',
    departureBlockEnd: '2030-03-20T00:30:00.000Z',
    createdAt: '2026-01-05T02:00:00.000Z',
  }),
  makePlan({
    id: 'plan-004',
    clientId: CLIENT_002_ID,
    serviceDate: SERVICE_DATE_MAR21,
    departureBlockStart: '2030-03-21T00:00:00.000Z',
    departureBlockEnd: '2030-03-21T00:30:00.000Z',
    notes: 'Tìm tài xế trực tiếp',
    createdAt: '2026-01-05T03:00:00.000Z',
  }),
]

const savedLocations = [
  { id: 'savedloc-001', label: 'Nhà', lat: 10.7769, lng: 106.7009 },
  { id: 'savedloc-002', label: 'Công ty', lat: 10.8544, lng: 106.7539 },
]

export async function seed() {
  const pool = initPool()
  const client = await pool.connect()

  console.log('Seeding database...')
  try {
    await client.query('BEGIN')

    await client.query(`
      TRUNCATE TABLE group_offers, search_requests, group_requests, plans, routes, cars, users, saved_locations CASCADE;
    `)

    // Insert users
    for (const u of users) {
      await client.query(
        `
        INSERT INTO users (id, mauid, display_name, avatar_url, verification_status, rating_avg, trip_count, role, preferred_mode, mode_selected_at, blocked_user_ids, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
        [
          u.id,
          u.mauid,
          u.displayName,
          u.avatarUrl,
          u.verificationStatus,
          u.ratingAvg,
          u.tripCount,
          u.role,
          u.preferredMode,
          u.modeSelectedAt,
          JSON.stringify(u.blockedUserIds),
          u.createdAt,
        ],
      )
    }

    // Insert cars
    for (const c of cars) {
      await client.query(
        `
        INSERT INTO cars (id, owner_id, nickname, plate_number_masked, plate_number_full, brand, model, color, seat_capacity, verification_status, photos, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
        [
          c.id,
          c.ownerId,
          c.nickname,
          c.plateNumberMasked,
          c.plateNumberFull,
          c.brand,
          c.model,
          c.color,
          c.seatCapacity,
          c.verificationStatus,
          JSON.stringify(c.photos),
          c.createdAt,
        ],
      )
    }

    // Insert routes
    for (const r of routes) {
      await client.query(
        `
        INSERT INTO routes (id, driver_id, car_id, origin, destination, origin_ward_id, origin_ward_key, origin_province_id, destination_ward_id, destination_ward_key, destination_province_id, service_date, departure_time, window_start, window_end, trip_price, notes, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `,
        [
          r.id,
          r.driverId,
          r.carId,
          JSON.stringify(r.origin),
          JSON.stringify(r.destination),
          r.originWardId,
          r.originWardKey,
          r.originProvinceId,
          r.destinationWardId,
          r.destinationWardKey,
          r.destinationProvinceId,
          r.serviceDate,
          r.departureTime,
          r.windowStart,
          r.windowEnd,
          r.tripPrice,
          r.notes,
          r.status,
          r.createdAt,
        ],
      )
    }

    // Insert plans
    for (const t of plans) {
      await client.query(
        `
        INSERT INTO plans (id, client_id, pickup, dropoff, pickup_ward_id, dropoff_ward_id, pickup_ward_key, dropoff_ward_key, pickup_province_id, dropoff_province_id, service_date, departure_block_start, departure_block_end, passenger_count, publish_mode, notes, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `,
        [
          t.id,
          t.clientId,
          JSON.stringify(t.pickup),
          JSON.stringify(t.dropoff),
          t.pickupWardId,
          t.dropoffWardId,
          t.pickupWardKey,
          t.dropoffWardKey,
          t.pickupProvinceId,
          t.dropoffProvinceId,
          t.serviceDate,
          t.departureBlockStart,
          t.departureBlockEnd,
          t.passengerCount,
          'grouped',
          t.notes,
          t.status,
          t.createdAt,
        ],
      )
    }

    // Insert saved locations
    for (const sl of savedLocations) {
      await client.query(
        `
        INSERT INTO saved_locations (id, label, lat, lng)
        VALUES ($1, $2, $3, $4)
      `,
        [sl.id, sl.label, sl.lat, sl.lng],
      )
    }

    await client.query('COMMIT')
    console.log('Seed completed successfully.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Seed failed:', err)
    throw err
  } finally {
    client.release()
    await closePool()
  }
}

if (require.main === module) {
  require('dotenv').config()
  seed().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
