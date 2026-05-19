import { initPool, query } from './connection'

async function main() {
  initPool()
  const r = await query('SELECT id, status, origin_ward_id, destination_ward_id, departure_date, window_start FROM plans ORDER BY id')
  for (const row of r.rows) {
    const dd = (row.departure_date as Date)?.toISOString?.() ?? row.departure_date
    const ws = (row.window_start as Date)?.toISOString?.() ?? row.window_start
    console.log(row.id, '|', row.status, '|', row.origin_ward_id, '|', dd, '|', ws)
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
