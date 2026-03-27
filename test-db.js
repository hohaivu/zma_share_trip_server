const { it: nodeIt } = require('node:test')
const { initPool, query, closePool } = require('./db/connection')
const fs = require('fs')
const path = require('path')
const { seed } = require('./db/seed')

let pool
let dbAvailable = false

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EACCES',
  'EPERM',
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

function isUnavailableDatabaseError(error) {
  const errors = [error, error?.cause].filter(Boolean)

  for (const current of errors) {
    const code = typeof current.code === 'string' ? current.code : ''
    if (UNAVAILABLE_CODES.has(code)) return true

    const message =
      typeof current.message === 'string' ? current.message : String(current)
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

async function setupTestDb() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/zma_share_trip'
  try {
    pool = initPool()
    await query(TRUNCATE_ALL_SQL)

    const migration1 = fs.readFileSync(
      path.join(__dirname, 'db', 'migrations', '01_init.sql'),
      'utf8',
    )
    const migration2 = fs.readFileSync(
      path.join(__dirname, 'db', 'migrations', '02_add_ward_keys.sql'),
      'utf8',
    )
    await query(migration1)
    await query(migration2)
    await query(TRUNCATE_ALL_SQL)

    await seed()
    pool = initPool()
    dbAvailable = true
    return true
  } catch (error) {
    await closePool().catch(() => {})
    pool = undefined
    dbAvailable = false

    if (isUnavailableDatabaseError(error)) {
      const detail =
        [error.name, error.code, error.message].filter(Boolean).join(': ') ||
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

async function teardownTestDb() {
  await closePool().catch(() => {})
}

/**
 * Creates a test wrapper that auto-skips when Postgres is unavailable.
 * @param {string} skipReason - Message shown when test is skipped
 * @returns {Function} Drop-in replacement for node:test `it`
 */
function createDbTest(skipReason) {
  return (name, fn) =>
    nodeIt(name, async (t, ...args) => {
      if (!dbAvailable) {
        t.skip(skipReason)
        return
      }
      return fn(t, ...args)
    })
}

function isDbAvailable() {
  return dbAvailable
}

module.exports = {
  setupTestDb,
  teardownTestDb,
  createDbTest,
  isDbAvailable,
}
