import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  mapRows,
  normalizeUtc,
  parseJsonb,
  parseNumeric,
  toCamelCase,
  toCamelCaseRecord,
} from '../src/db/utils'

// connection.ts: bigIntAsNumber: true → BIGINT arrives as JS number
// connection.ts: dateStrings: true   → DATETIME(3) arrives as 'YYYY-MM-DD HH:MM:SS.mmm'
// connection.ts: JSON columns auto-parsed by driver → arrives as object

describe('toCamelCaseRecord', () => {
  it('transforms snake_case keys to camelCase', () => {
    const row = { user_id: 'abc', created_at: null }
    const out = toCamelCaseRecord(row)
    assert.ok('userId' in out)
    assert.ok('createdAt' in out)
    assert.ok(!('user_id' in out))
  })

  it('converts BIGINT id (number) passthrough', () => {
    const row = { trip_count: 42, seat_capacity: 4 }
    const out = toCamelCaseRecord(row)
    assert.equal(out.tripCount, 42)
    assert.equal(out.seatCapacity, 4)
  })

  it('converts DATETIME(3) string (dateStrings:true) to ISO UTC', () => {
    const row = { created_at: '2024-01-15 10:30:45.123' }
    const out = toCamelCaseRecord(row)
    assert.equal(out.createdAt, '2024-01-15T10:30:45.123Z')
  })

  it('converts DATETIME string without milliseconds to ISO UTC', () => {
    const row = { updated_at: '2024-06-01 00:00:00' }
    const out = toCamelCaseRecord(row)
    assert.equal(out.updatedAt, '2024-06-01T00:00:00.000Z')
  })

  it('converts Date instance to ISO string', () => {
    const d = new Date('2024-03-10T08:00:00.000Z')
    const row = { departure_time: d }
    const out = toCamelCaseRecord(row)
    assert.equal(out.departureTime, d.toISOString())
  })

  it('preserves null values', () => {
    const row = { plan_id: null }
    const out = toCamelCaseRecord(row)
    assert.equal(out.planId, null)
  })

  it('preserves JSON object (auto-parsed by driver) passthrough', () => {
    const payload = { lat: 10.776, lng: 106.7 }
    const row = { location_json: payload }
    const out = toCamelCaseRecord(row)
    assert.deepEqual(out.locationJson, payload)
  })

  it('preserves boolean true/false passthrough', () => {
    const row = { is_active: true, is_deleted: false }
    const out = toCamelCaseRecord(row)
    assert.equal(out.isActive, true)
    assert.equal(out.isDeleted, false)
  })
})

describe('toCamelCase', () => {
  it('returns null for null input', () => {
    assert.equal(toCamelCase(null), null)
  })

  it('returns null for undefined input', () => {
    assert.equal(toCamelCase(undefined), null)
  })

  it('coerces and returns typed row', () => {
    const row = { driver_id: 'drv-1' }
    const out = toCamelCase<{ driverId: string }>(row)
    assert.equal(out?.driverId, 'drv-1')
  })
})

describe('mapRows', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(mapRows([]), [])
  })

  it('maps and transforms all rows', () => {
    const rows = [{ driver_id: 'a' }, { driver_id: 'b' }]
    const out = mapRows<{ driverId: string }>(rows)
    assert.equal(out.length, 2)
    assert.equal(out[0].driverId, 'a')
    assert.equal(out[1].driverId, 'b')
  })
})

describe('parseJsonb', () => {
  it('parses JSON string', () => {
    const val = '{"foo":"bar"}'
    assert.deepEqual(parseJsonb(val), { foo: 'bar' })
  })

  it('returns object as-is', () => {
    const obj = { foo: 'bar' }
    assert.equal(parseJsonb(obj), obj)
  })

  it('returns null for null input', () => {
    assert.equal(parseJsonb(null), null)
  })

  it('returns null for undefined input', () => {
    assert.equal(parseJsonb(undefined), null)
  })

  it('returns null for malformed JSON string (no throw)', () => {
    assert.equal(parseJsonb('not json}'), null)
  })

  it('returns empty array for "[]"', () => {
    assert.deepEqual(parseJsonb('[]'), [])
  })
})

describe('parseNumeric', () => {
  it('returns number as-is', () => {
    assert.equal(parseNumeric(3.14), 3.14)
  })

  it('parses numeric string', () => {
    assert.equal(parseNumeric('42.5'), 42.5)
  })

  it('returns 0 for null', () => {
    assert.equal(parseNumeric(null), 0)
  })

  it('returns 0 for undefined', () => {
    assert.equal(parseNumeric(undefined), 0)
  })

  it('returns 0 for NaN string', () => {
    assert.equal(parseNumeric('abc'), 0)
  })

  it('returns 0 for 0', () => {
    assert.equal(parseNumeric(0), 0)
  })
})

describe('normalizeUtc', () => {
  it('converts Date to ISO string', () => {
    const d = new Date('2024-01-01T00:00:00.000Z')
    assert.equal(normalizeUtc(d), '2024-01-01T00:00:00.000Z')
  })

  it('converts ISO string to ISO string', () => {
    const s = '2024-06-15T12:00:00.000Z'
    assert.equal(normalizeUtc(s), s)
  })

  it('returns undefined for null', () => {
    assert.equal(normalizeUtc(null), undefined)
  })

  it('returns undefined for undefined', () => {
    assert.equal(normalizeUtc(undefined), undefined)
  })
})
