const { Pool } = require('pg')

async function searchTable() {
  const dbs = ['postgres', 'Identity', 'flood_prediction_db', 'flood_prediction_test']
  for (const db of dbs) {
    const pool = new Pool({
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: '123456',
      database: db
    })
    try {
      const res = await pool.query(`
        SELECT table_schema, table_name 
        FROM information_schema.tables 
        WHERE table_name LIKE '%landslide%'
      `)
      if (res.rows.length > 0) {
        console.log(`Found in DB ${db}:`, res.rows)
      } else {
        console.log(`DB ${db}: no tables matching 'landslide'`)
      }
    } catch (err) {
      console.log(`DB ${db} Error:`, err.message)
    } finally {
      await pool.end()
    }
  }
}

searchTable()
