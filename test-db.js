const { initPool, query, closePool } = require('./db/connection')
const fs = require('fs')
const path = require('path')
const { seed } = require('./db/seed')

let pool

async function setupTestDb() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/zma_share_trip'
  pool = initPool()

  // Clean all tables
  await query(`
    DO $$ DECLARE
        r RECORD;
    BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
            EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
    END $$;
  `)

  // Re-run migration just in case (optional, we assume it's run)
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

  // Clean again to be sure
  await query(`
    DO $$ DECLARE
        r RECORD;
    BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
            EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
    END $$;
  `)

  // Run seed
  await seed()
  pool = initPool()
}

async function teardownTestDb() {
  await closePool()
}

module.exports = {
  setupTestDb,
  teardownTestDb,
}
