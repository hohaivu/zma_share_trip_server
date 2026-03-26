const { initPool, closePool } = require('./connection')

// The original seed data from store.js
const users = [
  {
    id: 'driver-001',
    zaloId: 'zalo-driver-001',
    displayName: 'Tài xế 001',
    avatarUrl: '',
    verificationStatus: 'verified',
    ratingAvg: 4.8,
    tripCount: 112,
    role: 'driver',
    preferredMode: 'driver',
    modeSelectedAt: '2026-01-01T00:00:00.000Z',
    blockedUserIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'driver-002',
    zaloId: 'zalo-driver-002',
    displayName: 'Tài xế 002',
    avatarUrl: '',
    verificationStatus: 'verified',
    ratingAvg: 4.5,
    tripCount: 45,
    role: 'driver',
    preferredMode: 'driver',
    modeSelectedAt: '2026-01-02T00:00:00.000Z',
    blockedUserIds: [],
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'client-001',
    zaloId: 'zalo-client-001',
    displayName: 'Hành khách 001',
    avatarUrl: '',
    verificationStatus: 'verified',
    ratingAvg: 4.7,
    tripCount: 52,
    role: 'client',
    preferredMode: 'client',
    modeSelectedAt: '2026-01-01T00:00:00.000Z',
    blockedUserIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'client-002',
    zaloId: 'zalo-client-002',
    displayName: 'Hành khách 002',
    avatarUrl: '',
    verificationStatus: 'verified',
    ratingAvg: 4.9,
    tripCount: 30,
    role: 'client',
    preferredMode: 'client',
    modeSelectedAt: '2026-01-02T00:00:00.000Z',
    blockedUserIds: [],
    createdAt: '2026-01-02T00:00:00.000Z',
  },
]

const cars = [
  {
    id: 'car-001',
    ownerId: 'driver-001',
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
    ownerId: 'driver-002',
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
  {
    id: 'route-001',
    driverId: 'driver-001',
    carId: 'car-001',
    origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
    destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
    serviceDate: '2030-03-20',
    departureTime: '2030-03-20T07:00:00.000Z',
    windowStart: '2030-03-20T06:45:00.000Z',
    windowEnd: '2030-03-20T07:15:00.000Z',
    tripPrice: 120000,
    notes: '',
    status: 'published',
    createdAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'route-002',
    driverId: 'driver-002',
    carId: 'car-002',
    origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
    destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
    serviceDate: '2030-03-20',
    departureTime: '2030-03-20T07:30:00.000Z',
    windowStart: '2030-03-20T07:15:00.000Z',
    windowEnd: '2030-03-20T07:45:00.000Z',
    tripPrice: 100000,
    notes: '',
    status: 'published',
    createdAt: '2026-01-05T00:00:00.000Z',
  },
]

const tripPlans = [
  {
    id: 'tripPlan-001',
    clientId: 'client-001',
    pickup: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
    dropoff: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
    pickupWardId: 'ward-q1-bennghe',
    dropoffWardId: 'ward-td-binhtho',
    pickupWardKey: 'ward-q1-bennghe_79',
    dropoffWardKey: 'ward-td-binhtho_79',
    pickupProvinceId: '79',
    dropoffProvinceId: '79',
    serviceDate: '2030-03-20',
    departureBlockStart: '2030-03-20T07:00:00.000Z',
    departureBlockEnd: '2030-03-20T07:30:00.000Z',
    passengerCount: 1,
    publishMode: 'grouped',
    notes: '',
    status: 'published',
    createdAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'tripPlan-002',
    clientId: 'client-002',
    pickup: { lat: 10.778, lng: 106.702, label: 'Quận 1' },
    dropoff: { lat: 10.855, lng: 106.754, label: 'Thủ Đức' },
    pickupWardId: 'ward-q1-bennghe',
    dropoffWardId: 'ward-td-binhtho',
    pickupWardKey: 'ward-q1-bennghe_79',
    dropoffWardKey: 'ward-td-binhtho_79',
    pickupProvinceId: '79',
    dropoffProvinceId: '79',
    serviceDate: '2030-03-20',
    departureBlockStart: '2030-03-20T07:00:00.000Z',
    departureBlockEnd: '2030-03-20T07:30:00.000Z',
    passengerCount: 2,
    publishMode: 'grouped',
    notes: '',
    status: 'published',
    createdAt: '2026-01-05T01:00:00.000Z',
  },
  {
    id: 'tripPlan-003',
    clientId: 'client-001',
    pickup: { lat: 10.8, lng: 106.65, label: 'Tân Bình' },
    dropoff: { lat: 10.85, lng: 106.76, label: 'Thủ Đức' },
    pickupWardId: 'ward-tb-p15',
    dropoffWardId: 'ward-td-binhtho',
    pickupWardKey: 'ward-tb-p15_79',
    dropoffWardKey: 'ward-td-binhtho_79',
    pickupProvinceId: '79',
    dropoffProvinceId: '79',
    serviceDate: '2030-03-20',
    departureBlockStart: '2030-03-20T07:00:00.000Z',
    departureBlockEnd: '2030-03-20T07:30:00.000Z',
    passengerCount: 1,
    publishMode: 'grouped',
    notes: '',
    status: 'published',
    createdAt: '2026-01-05T02:00:00.000Z',
  },
  {
    id: 'tripPlan-004',
    clientId: 'client-002',
    pickup: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
    dropoff: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
    pickupWardId: 'ward-q1-bennghe',
    dropoffWardId: 'ward-td-binhtho',
    pickupWardKey: 'ward-q1-bennghe_79',
    dropoffWardKey: 'ward-td-binhtho_79',
    pickupProvinceId: '79',
    dropoffProvinceId: '79',
    serviceDate: '2030-03-21',
    departureBlockStart: '2030-03-21T07:00:00.000Z',
    departureBlockEnd: '2030-03-21T07:30:00.000Z',
    passengerCount: 1,
    publishMode: 'search_only',
    notes: 'Tìm tài xế trực tiếp',
    status: 'published',
    createdAt: '2026-01-05T03:00:00.000Z',
  },
]

const savedLocations = [
  { id: 'savedloc-001', label: 'Nhà', lat: 10.7769, lng: 106.7009 },
  { id: 'savedloc-002', label: 'Công ty', lat: 10.8544, lng: 106.7539 },
]

async function seed() {
  const pool = initPool()
  const client = await pool.connect()

  console.log('Seeding database...')
  try {
    await client.query('BEGIN')

    // Clear existing data (cascading constraints should handle most, but we can truncate manually or just ignore conflicts if we want)
    // for safety we will truncate
    await client.query(`
      TRUNCATE TABLE group_offers, search_requests, group_requests, trip_plans, routes, cars, users, saved_locations CASCADE;
    `)

    // Insert users
    for (const u of users) {
      await client.query(
        `
        INSERT INTO users (id, zalo_id, display_name, avatar_url, verification_status, rating_avg, trip_count, role, preferred_mode, mode_selected_at, blocked_user_ids, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
        [
          u.id,
          u.zaloId,
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
        INSERT INTO routes (id, driver_id, car_id, origin, destination, service_date, departure_time, window_start, window_end, trip_price, notes, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
        [
          r.id,
          r.driverId,
          r.carId,
          JSON.stringify(r.origin),
          JSON.stringify(r.destination),
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

    // Insert trip plans
    for (const t of tripPlans) {
      await client.query(
        `
        INSERT INTO trip_plans (id, client_id, pickup, dropoff, pickup_ward_id, dropoff_ward_id, pickup_ward_key, dropoff_ward_key, pickup_province_id, dropoff_province_id, service_date, departure_block_start, departure_block_end, passenger_count, publish_mode, notes, status, created_at)
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
          t.publishMode,
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

module.exports = { seed }
