import { closePool, initPool } from './connection'

const TABLES = [
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

export async function truncateDatabase() {
  const pool = initPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`,
    )
    await client.query('COMMIT')
    console.log('Database truncated successfully.')
  } catch (err: unknown) {
    await client.query('ROLLBACK')
    console.error('Database truncate failed:', err)
    throw err
  } finally {
    client.release()
    await closePool()
  }
}

if (require.main === module) {
  require('dotenv').config()
  truncateDatabase().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
