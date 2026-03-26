const { Pool } = require('pg')

let pool

function initPool() {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  pool = new Pool({
    connectionString,
    // Add SSL support for managed databases like Render if needed
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
  })

  return pool
}

function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() first.')
  }
  return pool
}

async function checkConnection() {
  const p = initPool()
  const client = await p.connect()
  try {
    await client.query('SELECT 1')
  } finally {
    client.release()
  }
}

async function query(text, params) {
  const p = getPool()
  return p.query(text, params)
}

async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

async function withTransaction(callback) {
  const p = getPool()
  const client = await p.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  initPool,
  getPool,
  checkConnection,
  query,
  withTransaction,
  closePool,
}
