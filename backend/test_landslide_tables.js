require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function check() {
  try {
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('landslide_grid_nodes', 'landslide_predictions')
    `)
    console.log('Existing tables:', tableCheck.rows.map(r => r.table_name))

    const countNodes = await pool.query('SELECT COUNT(*) FROM landslide_grid_nodes')
    console.log('Nodes count:', countNodes.rows[0].count)

    try {
      const countPreds = await pool.query('SELECT COUNT(*) FROM landslide_predictions')
      console.log('Predictions count:', countPreds.rows[0].count)
    } catch (e) {
      console.log('Error counting predictions:', e.message)
    }

  } catch (err) {
    console.error('Check failed:', err.message)
  } finally {
    await pool.end()
  }
}

check()
