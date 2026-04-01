import { Pool, PoolClient, QueryResult, types } from 'pg'

let pool: Pool | null = null

// Centralize pg boundary coercion
// 1700 is the OID for NUMERIC
types.setTypeParser(1700, (val: string) => parseFloat(val))
// 1082 is the OID for DATE
types.setTypeParser(1082, (val: string) => val) // Keep as string (YYYY-MM-DD) instead of coercion to local Date
// 1184 is the OID for TIMESTAMPTZ
types.setTypeParser(1184, (val: string) => new Date(val).toISOString()) // Normalize to ISO string directly
// 1114 is the OID for TIMESTAMP
types.setTypeParser(1114, (val: string) => new Date(val + 'Z').toISOString())

export function initPool(): Pool {
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

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() first.')
  }
  return pool
}

export async function checkConnection(): Promise<void> {
  const p = initPool()
  const client = await p.connect()
  try {
    await client.query('SELECT 1')
  } finally {
    client.release()
  }
}

export async function query(
  text: string,
  params?: unknown[],
): Promise<QueryResult> {
  const p = getPool()
  return p.query(text, params)
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
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
