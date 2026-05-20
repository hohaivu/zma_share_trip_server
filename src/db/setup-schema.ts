import fs from 'fs'
import path from 'path'

import { closePool, initPool } from './connection'

export async function setupSchema() {
  const pool = initPool()
  const schemaPath = path.join(__dirname, 'schema.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')

  const statements = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  console.log('Applying database schema...')

  const conn = await pool.getConnection()
  try {
    for (const stmt of statements) {
      await conn.query(stmt)
    }

    // Mark all existing migration files as applied — schema.sql already reflects their state.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME(3) DEFAULT NOW()
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `)
    const migrationsDir = path.join(__dirname, 'migrations')
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of migrationFiles) {
      await conn.query('INSERT IGNORE INTO schema_migrations (id) VALUES (?)', [file])
    }

    console.log('Database schema applied successfully.')
  } catch (err: unknown) {
    console.error('Database schema setup failed:', err)
    throw err
  } finally {
    conn.release()
    await closePool()
  }
}

if (require.main === module) {
  require('dotenv').config()
  setupSchema().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
