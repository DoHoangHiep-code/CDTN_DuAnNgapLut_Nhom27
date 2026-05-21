const { Pool } = require('pg')

async function testDbs() {
  const dbs = ['Identity', 'flood_prediction_test']
  for (const db of dbs) {
    console.log(`Checking DB: ${db}`)
    const pool = new Pool({
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: '123456',
      database: db
    })
    try {
      const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
      console.log('Tables:', res.rows.map(r => r.table_name))
      const hasLandslide = res.rows.some(r => r.table_name === 'landslide_grid_nodes')
      if (hasLandslide) {
        console.log(`  ✓ FOUND landslide_grid_nodes in ${db}!`)
      }
    } catch (err) {
      console.log('Error:', err.message)
    } finally {
      await pool.end()
    }
  }
}

testDbs()
