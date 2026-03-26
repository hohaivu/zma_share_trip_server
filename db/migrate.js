const fs = require('fs')
const path = require('path')
const { initPool, closePool } = require('./connection')

async function migrate() {
  const pool = initPool()

  const migrationPath = path.join(__dirname, 'migrations', '01_init.sql')
  const sql = fs.readFileSync(migrationPath, 'utf8')

  console.log('Running schema migration...')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('Migration completed successfully.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Migration failed:', err)
    throw err
  } finally {
    client.release()
    await closePool()
  }
}

if (require.main === module) {
  require('dotenv').config()
  migrate().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { migrate }
