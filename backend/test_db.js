require('dotenv').config()
const { Pool } = require('pg')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1
})

async function test() {
  console.log('Connecting...')
  const client = await pool.connect()
  try {
    const sql = `
      SELECT fp.risk_level
      FROM flood_predictions fp
      JOIN grid_nodes gn ON fp.node_id = gn.node_id
      AS OF SYSTEM TIME '-10s'
    `
    await client.query(sql)
    console.log('Test OK')
  } catch (err) {
    console.error('Query error:', err.message)
  } finally {
    client.release()
    pool.end()
  }
}
test()
