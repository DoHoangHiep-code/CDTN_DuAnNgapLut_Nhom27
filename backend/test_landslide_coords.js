const { Pool } = require('pg')

const connectionString = 'postgresql://h1234561:RxHwLkmC_voC-x7ZLODUbA@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full'

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
})

async function check() {
  try {
    console.log('Querying landslide_grid_nodes...')
    const result = await pool.query('SELECT COUNT(*), COUNT(province) as non_null_province FROM landslide_grid_nodes')
    console.log('Counts:', result.rows[0])

    const sample = await pool.query('SELECT node_id, lat, lon, province FROM landslide_grid_nodes LIMIT 10')
    console.log('Sample rows:', sample.rows)

    const minMax = await pool.query('SELECT MIN(lat) as min_lat, MAX(lat) as max_lat, MIN(lon) as min_lon, MAX(lon) as max_lon FROM landslide_grid_nodes')
    console.log('Min/Max coords:', minMax.rows[0])
  } catch (err) {
    console.error('Error querying database:', err)
  } finally {
    await pool.end()
  }
}

check()
