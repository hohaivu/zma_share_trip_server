import fs from 'fs'
import { TestContext, it as nodeIt } from 'node:test'
import path from 'path'

import { closePool, initPool } from './db/connection'
import { seed } from './db/seed'

let dbAvailable = false

const TABLES_IN_ORDER = [
  'notifications',
  'reports',
  'reviews',
  'wallet_transactions',
  'wallets',
  'saved_locations',
  'route_requests',
  'group_offers',
  'group_requests',
  'plans',
  'routes',
  'cars',
  'identity_blocks',
  'users',
  'identities',
]

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EACCES',
  'EPERM',
  'ER_ACCESS_DENIED_ERROR',
])
const UNAVAILABLE_MESSAGES = ['access denied', 'permission denied', 'operation not permitted']

function isUnavailableDatabaseError(error: unknown): boolean {
  const errors = [error, (error as Record<string, unknown>)?.cause].filter(
    Boolean,
  )

  for (const current of errors) {
    const obj = current as Record<string, unknown>
    const code = typeof obj.code === 'string' ? obj.code : ''
    if (UNAVAILABLE_CODES.has(code)) return true

    const message =
      typeof obj.message === 'string' ? obj.message : String(current)
    for (const keyword of UNAVAILABLE_CODES) {
      if (message.includes(keyword)) return true
    }
    const lower = message.toLowerCase()
    for (const keyword of UNAVAILABLE_MESSAGES) {
      if (lower.includes(keyword)) return true
    }
  }

  return false
}

async function truncateAll(conn: { query: (sql: string) => Promise<unknown> }) {
  await conn.query('SET FOREIGN_KEY_CHECKS=0')
  for (const table of TABLES_IN_ORDER) {
    try {
      await conn.query(`TRUNCATE TABLE ${table}`)
    } catch (error: unknown) {
      const code = (error as Record<string, unknown>)?.code
      if (code !== 'ER_NO_SUCH_TABLE') throw error
    }
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1')
}

export async function setupTestDb() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    'mariadb://mariadb:mariadb@localhost:3307/share_trip_db'
  try {
    const pool = initPool()
    const conn = await pool.getConnection()
    try {
      await truncateAll(conn)

      const schemaPath = path.join(__dirname, 'db', 'schema.sql')
      const schemaSql = fs.readFileSync(schemaPath, 'utf8')
      const statements = schemaSql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      for (const stmt of statements) {
        await conn.query(stmt)
      }

      await truncateAll(conn)
    } finally {
      conn.release()
    }

    await seed()
    initPool()
    dbAvailable = true
    return true
  } catch (error: unknown) {
    await closePool().catch(() => {})
    dbAvailable = false

    if (isUnavailableDatabaseError(error)) {
      const err = error as Record<string, unknown>
      const detail =
        [err.name, err.code, err.message].filter(Boolean).join(': ') ||
        String(error)
      console.warn(
        '[test-db] Skipping DB-backed tests — MariaDB unavailable:',
        detail,
      )
      return false
    }

    throw error
  }
}

export async function teardownTestDb() {
  await closePool().catch(() => {})
}

/**
 * Creates a test wrapper that auto-skips when MariaDB is unavailable.
 * @param skipReason - Message shown when test is skipped
 * @returns Drop-in replacement for node:test `it`
 */
export function createDbTest(skipReason: string) {
  return (name: string, fn: (t: TestContext) => Promise<void> | void) =>
    nodeIt(name, async (t: TestContext) => {
      if (!dbAvailable) {
        t.skip(skipReason)
        return
      }
      return fn(t)
    })
}

export function isDbAvailable() {
  return dbAvailable
}
