const { Pool } = require('pg')

const connectionString = 'postgresql://s_:_rIigkJpJxIP9RJUS4OkTw@ninja-hacker-15200.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full'

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
})

async function check() {
  try {
    console.log('Connecting to NEW database...')
    const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    console.log('Tables:', result.rows.map(r => r.table_name))
  } catch (err) {
    console.error('Error querying database:', err)
  } finally {
    await pool.end()
  }
}

check()
