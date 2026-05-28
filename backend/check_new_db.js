const { Client } = require('pg')

const NEW_URL = 'postgresql://hiep1234561:-WIbZmFLHwEH6a2CCL76CA@crab-deer-16109.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full'
const OLD_URL = 'postgresql://h1234561:RxHwLkmC_voC-x7ZLODUbA@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full'

async function checkNew() {
  const client = new Client({ connectionString: NEW_URL })
  await client.connect()

  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `)

  console.log('=== NEW DB – Trạng thái hiện tại ===\n')
  for (const row of tables.rows) {
    const c = await client.query(`SELECT COUNT(*) FROM "${row.table_name}"`)
    console.log(`  ${row.table_name.padEnd(32)}: ${c.rows[0].count}`)
  }

  // Kiểm tra users cụ thể
  console.log('\n--- USERS ---')
  const users = await client.query('SELECT username, email, role FROM users ORDER BY role')
  for (const u of users.rows) console.log(`  [${u.role}] ${u.username} – ${u.email}`)

  // Kiểm tra weather_stations
  console.log('\n--- WEATHER_STATIONS (sample) ---')
  const ws = await client.query('SELECT id, name, latitude, longitude, node_count FROM weather_stations LIMIT 3')
  for (const w of ws.rows) console.log(`  ${w.id}: ${w.name} (${w.latitude}, ${w.longitude}) node_count=${w.node_count}`)
  const wsCount = await client.query('SELECT COUNT(*) FROM weather_stations')
  console.log(`  Total: ${wsCount.rows[0].count}`)

  // Kiểm tra grid_nodes với IDW
  console.log('\n--- GRID_NODES IDW check ---')
  const idw = await client.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(st1_id) as has_idw,
      COUNT(weather_station_id) as has_station,
      COUNT(location_name) FILTER (WHERE location_name NOT LIKE 'Grid\_%') as has_geocoded_name
    FROM grid_nodes
  `)
  console.log(`  Total: ${idw.rows[0].total}`)
  console.log(`  Has IDW: ${idw.rows[0].has_idw}`)
  console.log(`  Has Station: ${idw.rows[0].has_station}`)
  console.log(`  Has geocoded name: ${idw.rows[0].has_geocoded_name}`)

  await client.end()
}

checkNew().catch(e => { console.error('❌', e.message); process.exit(1) })
