const { Pool } = require('pg')

const connectionString = 'postgresql://h1234561:RxHwLkmC_voC-x7ZLODUbA@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full'

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
})

async function check() {
  try {
    console.log('Connecting to cosmic-kite with new password...')
    const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    console.log('Tables:', result.rows.map(r => r.table_name))
  } catch (err) {
    console.error('Error querying database:', err)
  } finally {
    await pool.end()
  }
}

check()
