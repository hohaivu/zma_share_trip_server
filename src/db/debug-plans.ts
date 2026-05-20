import { initPool, query } from './connection'

async function main() {
  initPool()
  const r = await query('SELECT id, status, origin_ward_id, destination_ward_id, departure_window_start_date, departure_window_end_date FROM plans ORDER BY id')
  for (const row of r.rows) {
    const dd = (row.departure_window_start_date as Date)?.toISOString?.() ?? row.departure_window_start_date
    const we = (row.departure_window_end_date as Date)?.toISOString?.() ?? row.departure_window_end_date
    console.log(row.id, '|', row.status, '|', row.origin_ward_id, '|', dd, '|', we)
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
