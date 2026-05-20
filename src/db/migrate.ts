import fs from 'fs'
import path from 'path'

import { closePool, initPool } from './connection'

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(255) PRIMARY KEY,
    applied_at DATETIME(3) DEFAULT NOW()
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`

const SKIP_TOKENS = new Set(['BEGIN', 'COMMIT', 'START TRANSACTION'])

export async function runMigrations() {
  const pool = initPool()
  const migrationsDir = path.join(__dirname, 'migrations')

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const conn = await pool.getConnection()
  try {
    await conn.query(MIGRATIONS_TABLE)

    const rows = (await conn.query('SELECT id FROM schema_migrations')) as { id: string }[]
    const applied = new Set(rows.map((r) => r.id))

    const pending = files.filter((f) => !applied.has(f))

    if (pending.length === 0) {
      console.log('No pending migrations.')
      return
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !SKIP_TOKENS.has(s.toUpperCase()))

      console.log(`Applying migration: ${file}`)
      for (const stmt of statements) {
        await conn.query(stmt)
      }

      await conn.query('INSERT INTO schema_migrations (id) VALUES (?)', [file])
      console.log(`  Applied: ${file}`)
    }

    console.log('Migrations complete.')
  } catch (err: unknown) {
    console.error('Migration failed:', err)
    throw err
  } finally {
    conn.release()
    await closePool()
  }
}

if (require.main === module) {
  require('dotenv').config()
  runMigrations().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
