import fs from 'fs'
import path from 'path'

import { closePool, initPool } from './connection'

export async function setupSchema() {
  const pool = initPool()
  const schemaPath = path.join(__dirname, 'schema.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')

  console.log('Applying database schema...')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(schemaSql)
    await client.query('COMMIT')
    console.log('Database schema applied successfully.')
  } catch (err: unknown) {
    await client.query('ROLLBACK')
    console.error('Database schema setup failed:', err)
    throw err
  } finally {
    client.release()
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
