import { Location, User } from '../types/entities'
import { closePool, initPool } from './connection'

// --- Named constants ---

const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const DRIVER_002_ID = 'a1b2c3d4-0002-4000-8000-000000000002'
const CLIENT_001_ID = 'a1b2c3d4-0003-4000-8000-000000000003'
const CLIENT_002_ID = 'a1b2c3d4-0004-4000-8000-000000000004'
const DRIVER_001_CLIENT_ID = 'a1b2c3d4-1001-4000-8000-000000000001'
const DRIVER_002_CLIENT_ID = 'a1b2c3d4-1002-4000-8000-000000000002'
const CLIENT_001_DRIVER_ID = 'a1b2c3d4-1003-4000-8000-000000000003'
const CLIENT_002_DRIVER_ID = 'a1b2c3d4-1004-4000-8000-000000000004'

const COORD_Q1 = { lat: 10.7769, lng: 106.7009, label: 'Quận 1' }
const COORD_TD = { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' }
const COORD_Q1_NEAR = { lat: 10.778, lng: 106.702, label: 'Quận 1' }
const COORD_TD_NEAR = { lat: 10.855, lng: 106.754, label: 'Thủ Đức' }
const COORD_TB = { lat: 10.8, lng: 106.65, label: 'Tân Bình' }
const COORD_TD_TB = { lat: 10.85, lng: 106.76, label: 'Thủ Đức' }

const WARD_Q1 = 'ward-q1-bennghe'
const WARD_TD = 'ward-td-binhtho'
const PROVINCE_HCM = '79'

interface SeedUser extends Omit<User, 'createdAt' | 'modeSelectedAt'> {
  identityId: string
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
  originProvinceId: string
  destinationWardId: string
  destinationProvinceId: string
  departureWindowStartDate: string
  departureWindowEndDate: string
  tripPrice: number
  distanceMeters?: number | null
  feeRateVndPerKm?: number
  feeRequiredVnd?: number
  walletFeeStatus?: 'none' | 'reserved' | 'charged' | 'released' | 'refunded'
  walletReservedAt?: string | null
  walletChargedAt?: string | null
  walletReleasedAt?: string | null
  walletRefundedAt?: string | null
  notes: string
  status: string
  createdAt: string
}

interface SeedWallet {
  id: string
  driverId: string
  balanceVnd: number
  reservedBalanceVnd: number
  createdAt: string
  updatedAt: string
}

interface SeedPlan {
  id: string
  clientId: string
  origin: Location
  destination: Location
  originWardId: string
  originProvinceId: string
  destinationWardId: string
  destinationProvinceId: string
  departureWindowStartDate: string
  departureWindowEndDate: string
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
      | 'departureWindowStartDate'
      | 'departureWindowEndDate'
      | 'tripPrice'
      | 'createdAt'
    >,
): SeedRoute {
  return {
    origin: COORD_Q1,
    destination: COORD_TD,
    originWardId: WARD_Q1,
    originProvinceId: PROVINCE_HCM,
    destinationWardId: WARD_TD,
    destinationProvinceId: PROVINCE_HCM,
    distanceMeters: null,
    feeRateVndPerKm: 0,
    feeRequiredVnd: 0,
    walletFeeStatus: 'none',
    walletReservedAt: null,
    walletChargedAt: null,
    walletReleasedAt: null,
    walletRefundedAt: null,
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
      | 'departureWindowStartDate'
      | 'departureWindowEndDate'
      | 'createdAt'
    >,
): SeedPlan {
  return {
    origin: COORD_Q1,
    destination: COORD_TD,
    originWardId: WARD_Q1,
    destinationWardId: WARD_TD,
    originProvinceId: PROVINCE_HCM,
    destinationProvinceId: PROVINCE_HCM,
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
    identityId: 'identity-driver-001',
    mauid: 'zalo-driver-001',
    displayName: 'Tài xế 001',
    ratingAvg: 4.8,
    tripCount: 112,
    role: 'driver',
    preferredMode: 'driver',
    modeSelectedAt: '2026-01-01 00:00:00.000',
    createdAt: '2026-01-01 00:00:00.000',
  }),
  makeUser({
    id: DRIVER_001_CLIENT_ID,
    identityId: 'identity-driver-001',
    mauid: 'zalo-driver-001',
    displayName: 'Tài xế 001',
    role: 'client',
    preferredMode: 'driver',
    modeSelectedAt: '2026-01-01 00:00:00.000',
    createdAt: '2026-01-01 00:00:00.000',
  }),
  makeUser({
    id: DRIVER_002_ID,
    identityId: 'identity-driver-002',
    mauid: 'zalo-driver-002',
    displayName: 'Tài xế 002',
    ratingAvg: 4.5,
    tripCount: 45,
    role: 'driver',
    preferredMode: 'driver',
    modeSelectedAt: '2026-01-02 00:00:00.000',
    createdAt: '2026-01-02 00:00:00.000',
  }),
  makeUser({
    id: DRIVER_002_CLIENT_ID,
    identityId: 'identity-driver-002',
    mauid: 'zalo-driver-002',
    displayName: 'Tài xế 002',
    role: 'client',
    preferredMode: 'driver',
    modeSelectedAt: '2026-01-02 00:00:00.000',
    createdAt: '2026-01-02 00:00:00.000',
  }),
  makeUser({
    id: CLIENT_001_ID,
    identityId: 'identity-client-001',
    mauid: 'zalo-client-001',
    displayName: 'Hành khách 001',
    ratingAvg: 4.7,
    tripCount: 52,
    role: 'client',
    preferredMode: 'client',
    modeSelectedAt: '2026-01-01 00:00:00.000',
    createdAt: '2026-01-01 00:00:00.000',
  }),
  makeUser({
    id: CLIENT_001_DRIVER_ID,
    identityId: 'identity-client-001',
    mauid: 'zalo-client-001',
    displayName: 'Hành khách 001',
    role: 'driver',
    preferredMode: 'client',
    modeSelectedAt: '2026-01-01 00:00:00.000',
    createdAt: '2026-01-01 00:00:00.000',
  }),
  makeUser({
    id: CLIENT_002_ID,
    identityId: 'identity-client-002',
    mauid: 'zalo-client-002',
    displayName: 'Hành khách 002',
    ratingAvg: 4.9,
    tripCount: 30,
    role: 'client',
    preferredMode: 'client',
    modeSelectedAt: '2026-01-02 00:00:00.000',
    createdAt: '2026-01-02 00:00:00.000',
  }),
  makeUser({
    id: CLIENT_002_DRIVER_ID,
    identityId: 'identity-client-002',
    mauid: 'zalo-client-002',
    displayName: 'Hành khách 002',
    role: 'driver',
    preferredMode: 'client',
    modeSelectedAt: '2026-01-02 00:00:00.000',
    createdAt: '2026-01-02 00:00:00.000',
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
    createdAt: '2026-01-03 00:00:00.000',
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
    createdAt: '2026-01-04 00:00:00.000',
  },
]

const wallets: SeedWallet[] = [
  {
    id: 'wallet-001',
    driverId: DRIVER_001_ID,
    balanceVnd: 500000,
    reservedBalanceVnd: 0,
    createdAt: '2026-01-03 00:00:00.000',
    updatedAt: '2026-01-03 00:00:00.000',
  },
  {
    id: 'wallet-002',
    driverId: DRIVER_002_ID,
    balanceVnd: 250000,
    reservedBalanceVnd: 0,
    createdAt: '2026-01-04 00:00:00.000',
    updatedAt: '2026-01-04 00:00:00.000',
  },
]

const routes = [
  makeRoute({
    id: 'route-001',
    driverId: DRIVER_001_ID,
    carId: 'car-001',
    departureWindowStartDate: '2030-03-20 00:00:00.000',
    departureWindowEndDate: '2030-03-20 00:30:00.000',
    tripPrice: 120000,
    createdAt: '2026-01-05 00:00:00.000',
  }),
  makeRoute({
    id: 'route-002',
    driverId: DRIVER_002_ID,
    carId: 'car-002',
    departureWindowStartDate: '2030-03-20 00:15:00.000',
    departureWindowEndDate: '2030-03-20 00:45:00.000',
    tripPrice: 100000,
    createdAt: '2026-01-05 00:00:00.000',
  }),
]

const plans = [
  makePlan({
    id: 'plan-001',
    clientId: CLIENT_001_ID,
    departureWindowStartDate: '2030-03-20 00:00:00.000',
    departureWindowEndDate: '2030-03-20 00:30:00.000',
    createdAt: '2026-01-05 00:00:00.000',
  }),
  makePlan({
    id: 'plan-002',
    clientId: CLIENT_002_ID,
    origin: COORD_Q1_NEAR,
    destination: COORD_TD_NEAR,
    departureWindowStartDate: '2030-03-20 00:00:00.000',
    departureWindowEndDate: '2030-03-20 00:30:00.000',
    passengerCount: 2,
    createdAt: '2026-01-05 01:00:00.000',
  }),
  makePlan({
    id: 'plan-003',
    clientId: CLIENT_001_ID,
    origin: COORD_TB,
    destination: COORD_TD_TB,
    originWardId: 'ward-tb-p15',
    departureWindowStartDate: '2030-03-20 00:00:00.000',
    departureWindowEndDate: '2030-03-20 00:30:00.000',
    createdAt: '2026-01-05 02:00:00.000',
  }),
  makePlan({
    id: 'plan-004',
    clientId: CLIENT_002_ID,
    departureWindowStartDate: '2030-03-21 00:00:00.000',
    departureWindowEndDate: '2030-03-21 00:30:00.000',
    notes: 'Tìm tài xế trực tiếp',
    createdAt: '2026-01-05 03:00:00.000',
  }),
]

const savedLocations = [
  { id: 'savedloc-001', label: 'Nhà', lat: 10.7769, lng: 106.7009 },
  { id: 'savedloc-002', label: 'Công ty', lat: 10.8544, lng: 106.7539 },
]

export async function seed() {
  const pool = initPool()
  const conn = await pool.getConnection()

  console.log('Seeding database...')
  try {
    // Truncate all tables with FK checks disabled (MariaDB TRUNCATE does not support CASCADE)
    await conn.query('SET FOREIGN_KEY_CHECKS=0')
    for (const table of [
      'wallet_transactions',
      'wallets',
      'group_offers',
      'route_requests',
      'group_requests',
      'plans',
      'routes',
      'cars',
      'users',
      'identities',
      'saved_locations',
    ]) {
      await conn.query(`TRUNCATE TABLE ${table}`)
    }
    await conn.query('SET FOREIGN_KEY_CHECKS=1')

    await conn.query('BEGIN')

    // Insert identities and role-specific personas
    for (const u of users) {
      await conn.query(
        `
        INSERT IGNORE INTO identities (id, mauid, display_name, avatar_url, preferred_mode, mode_selected_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          u.identityId,
          u.mauid,
          u.displayName,
          u.avatarUrl,
          u.preferredMode,
          u.modeSelectedAt,
          u.createdAt,
          u.createdAt,
        ],
      )
      await conn.query(
        `
        INSERT INTO users (id, identity_id, verification_status, rating_avg, trip_count, role, blocked_user_ids, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          u.id,
          u.identityId,
          u.verificationStatus,
          u.ratingAvg,
          u.tripCount,
          u.role,
          JSON.stringify(u.blockedUserIds),
          u.createdAt,
        ],
      )
    }

    // Insert cars
    for (const c of cars) {
      await conn.query(
        `
        INSERT INTO cars (id, owner_id, nickname, plate_number_masked, plate_number_full, brand, model, color, seat_capacity, verification_status, photos, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      await conn.query(
        `
        INSERT INTO routes (
          id, driver_id, car_id, origin, destination,
          origin_ward_id, origin_province_id,
          destination_ward_id, destination_province_id,
          departure_window_start_date, departure_window_end_date,
          trip_price, distance_meters, fee_rate_vnd_per_km, fee_required_vnd,
          wallet_fee_status, wallet_reserved_at, wallet_charged_at,
          wallet_released_at, wallet_refunded_at, notes, status, created_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
        [
          r.id,
          r.driverId,
          r.carId,
          JSON.stringify(r.origin),
          JSON.stringify(r.destination),
          r.originWardId,
          r.originProvinceId,
          r.destinationWardId,
          r.destinationProvinceId,
          r.departureWindowStartDate,
          r.departureWindowEndDate,
          r.tripPrice,
          r.distanceMeters,
          r.feeRateVndPerKm,
          r.feeRequiredVnd,
          r.walletFeeStatus,
          r.walletReservedAt,
          r.walletChargedAt,
          r.walletReleasedAt,
          r.walletRefundedAt,
          r.notes,
          r.status,
          r.createdAt,
        ],
      )
    }

    // Insert wallets
    for (const wallet of wallets) {
      await conn.query(
        `
        INSERT INTO wallets (
          id, driver_id, balance_vnd, reserved_balance_vnd, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        [
          wallet.id,
          wallet.driverId,
          wallet.balanceVnd,
          wallet.reservedBalanceVnd,
          wallet.createdAt,
          wallet.updatedAt,
        ],
      )
    }

    // Insert plans
    for (const t of plans) {
      await conn.query(
        `
        INSERT INTO plans (id, client_id, origin, destination, origin_ward_id, destination_ward_id, origin_province_id, destination_province_id, departure_window_start_date, departure_window_end_date, passenger_count, publish_mode, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          t.id,
          t.clientId,
          JSON.stringify(t.origin),
          JSON.stringify(t.destination),
          t.originWardId,
          t.destinationWardId,
          t.originProvinceId,
          t.destinationProvinceId,
          t.departureWindowStartDate,
          t.departureWindowEndDate,
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
      await conn.query(
        `
        INSERT INTO saved_locations (id, label, lat, lng)
        VALUES (?, ?, ?, ?)
      `,
        [sl.id, sl.label, sl.lat, sl.lng],
      )
    }

    await conn.query('COMMIT')
    console.log('Seed completed successfully.')
  } catch (err) {
    console.error('Seed failed:', err)
    try { await conn.query('ROLLBACK') } catch { /* ignore rollback failure */ }
    throw err
  } finally {
    conn.release()
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
