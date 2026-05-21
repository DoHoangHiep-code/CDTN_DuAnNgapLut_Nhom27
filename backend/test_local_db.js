const { Pool } = require('pg')

async function testLocal() {
  const configs = [
    {
      label: 'Local with postgres:123456/flood_prediction_db',
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: '123456',
      database: 'flood_prediction_db'
    },
    {
      label: 'Local with postgres:postgres/flood_prediction_db',
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'flood_prediction_db'
    },
    {
      label: 'Local postgres default',
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: '123456',
      database: 'postgres'
    }
  ]

  for (const cfg of configs) {
    console.log(`Testing: ${cfg.label}`)
    const pool = new Pool(cfg)
    try {
      const client = await pool.connect()
      console.log('  ✓ Connected!')
      const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
      console.log('  ✓ Tables:', tables.rows.map(r => r.table_name))
      client.release()
    } catch (err) {
      console.log('  ✗ Failed:', err.message)
    } finally {
      await pool.end()
    }
  }
}

testLocal()
