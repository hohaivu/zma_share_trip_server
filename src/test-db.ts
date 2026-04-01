import fs from 'fs'
import { TestContext, it as nodeIt } from 'node:test'
import path from 'path'
import { Pool } from 'pg'

import { closePool, initPool, query } from './db/connection'
import { seed } from './db/seed'

let pool: Pool | undefined
let dbAvailable = false

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EACCES',
  'EPERM',
  '28000',
])
const UNAVAILABLE_MESSAGES = ['permission denied', 'operation not permitted']

const TRUNCATE_ALL_SQL = `
  DO $$ DECLARE
      r RECORD;
  BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
  END $$;
`

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

export async function setupTestDb() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/zma_share_trip'
  try {
    pool = initPool()
    await query(TRUNCATE_ALL_SQL)

    const migrationsDir = path.join(__dirname, 'db', 'migrations')
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    for (const migrationFile of migrationFiles) {
      const migrationSql = fs.readFileSync(
        path.join(migrationsDir, migrationFile),
        'utf8',
      )
      await query(migrationSql)
    }
    await query(TRUNCATE_ALL_SQL)

    await seed()
    pool = initPool()
    dbAvailable = true
    return true
  } catch (error: unknown) {
    await closePool().catch(() => {})
    pool = undefined
    dbAvailable = false

    if (isUnavailableDatabaseError(error)) {
      const err = error as Record<string, unknown>
      const detail =
        [err.name, err.code, err.message].filter(Boolean).join(': ') ||
        String(error)
      console.warn(
        '[test-db] Skipping DB-backed tests — Postgres unavailable:',
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
 * Creates a test wrapper that auto-skips when Postgres is unavailable.
 * @param skipReason - Message shown when test is skipped
 * @returns Drop-in replacement for node:test \`it\`
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
