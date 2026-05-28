import * as mariadb from 'mariadb'

export type QueryResult = { rows: Record<string, unknown>[]; rowCount: number }
export type TransactionClient = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>
}

let pool: mariadb.Pool | null = null

// Pool lifecycle is owned at the application boundary: init once during boot,
// reuse via getPool(), and close explicitly on shutdown.
export function initPool(): mariadb.Pool {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const url = new URL(connectionString)
  pool = mariadb.createPool({
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    charset: 'utf8mb4',
    bigIntAsNumber: true,
    dateStrings: true,
    checkDuplicate: false,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : undefined,
  })

  return pool
}

export function getPool(): mariadb.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() first.')
  }
  return pool
}

export async function checkConnection(): Promise<void> {
  const p = initPool()
  const conn = await p.getConnection()
  try {
    await conn.query('SELECT 1')
  } finally {
    conn.release()
  }
}

function toQueryResult(result: unknown): QueryResult {
  if (Array.isArray(result)) {
    return {
      rows: result as Record<string, unknown>[],
      rowCount: result.length,
    }
  }
  const r = result as { affectedRows?: number }
  return { rows: [], rowCount: r?.affectedRows ?? 0 }
}

// MariaDB DATETIME doesn't accept ISO 8601 'T'/'Z' format.
// Convert to 'YYYY-MM-DD HH:MM:SS.mmm' UTC string that MariaDB stores literally.
export function normalizeParams(params?: unknown[]): unknown[] | undefined {
  if (!params) return params
  return params.map((p) => {
    if (typeof p === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(p)) {
      const d = new Date(p)
      const pad = (n: number, len = 2) => String(n).padStart(len, '0')
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
    }
    return p
  })
}

// Convert Postgres-style SQL to MariaDB-compatible SQL.
// Handles: $N positional params → ?, ON CONFLICT DO NOTHING → INSERT IGNORE.
function normalizeSql(
  text: string,
  params?: unknown[],
): { sql: string; params: unknown[] | undefined } {
  let sql = text
  let outParams = params

  if (params && /\$\d+/.test(sql)) {
    const newParams: unknown[] = []
    sql = sql.replace(/\$(\d+)/g, (_, n) => {
      newParams.push(params[parseInt(n, 10) - 1])
      return '?'
    })
    outParams = newParams
  }

  if (/ON\s+CONFLICT\b/i.test(sql)) {
    sql = sql.replace(/\bINSERT\s+INTO\b/i, 'INSERT IGNORE INTO')
    sql = sql.replace(/\s+ON\s+CONFLICT\s*\([^)]*\)\s*DO\s+NOTHING/gi, '')
  }

  return { sql, params: outParams }
}

export async function query(
  text: string,
  params?: unknown[],
): Promise<QueryResult> {
  const p = getPool()
  const normalized = normalizeSql(text, params)
  const result = await p.query(normalized.sql, normalizeParams(normalized.params))
  return toQueryResult(result)
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export async function withTransaction<T>(
  callback: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  const p = getPool()
  const conn = await p.getConnection()
  const client: TransactionClient = {
    query: async (sql: string, params?: unknown[]) => {
      const normalized = normalizeSql(sql, params)
      const result = await conn.query(normalized.sql, normalizeParams(normalized.params))
      return toQueryResult(result)
    },
  }
  try {
    await conn.query('BEGIN')
    const result = await callback(client)
    await conn.query('COMMIT')
    return result
  } catch (err) {
    await conn.query('ROLLBACK')
    throw err
  } finally {
    conn.release()
  }
}
