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
  const conn = await pool.getConnection()
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0')
    for (const table of TABLES) {
      await conn.query(`TRUNCATE TABLE ${table}`)
    }
    await conn.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('Database truncated successfully.')
  } catch (err: unknown) {
    console.error('Database truncate failed:', err)
    throw err
  } finally {
    conn.release()
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
