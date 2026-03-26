const fs = require('fs')
const path = require('path')
const { initPool, closePool } = require('./connection')

async function migrate() {
  const pool = initPool()
  const migrationsDir = path.join(__dirname, 'migrations')
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  console.log('Running schema migration...')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(migrationsDir, migrationFile)
      const sql = fs.readFileSync(migrationPath, 'utf8')
      console.log(`Applying migration: ${migrationFile}`)
      await client.query(sql)
    }
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
