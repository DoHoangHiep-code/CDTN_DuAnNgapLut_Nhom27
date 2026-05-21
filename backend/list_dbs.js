const { Pool } = require('pg')

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: '123456',
  database: 'postgres'
})

async function check() {
  try {
    const res = await pool.query('SELECT datname FROM pg_database WHERE datistemplate = false')
    console.log('Databases:', res.rows.map(r => r.datname))
  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await pool.end()
  }
}

check()
