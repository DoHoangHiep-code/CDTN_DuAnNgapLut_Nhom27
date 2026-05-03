const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // 🔥 QUAN TRỌNG
  },
})

pool.on('connect', () => {
  console.log('[DB] Kết nối PostgreSQL thành công.')
})

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message)
})

module.exports = { pool }