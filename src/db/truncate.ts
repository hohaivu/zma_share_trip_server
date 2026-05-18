import { closePool, initPool } from './connection'

const TRUNCATE_ALL_SQL = `
  DO $$ DECLARE
      r RECORD;
  BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
  END $$;
`

export async function truncateDatabase() {
  const pool = initPool()

  console.log('Truncating database...')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(TRUNCATE_ALL_SQL)
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
