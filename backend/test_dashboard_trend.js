const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL, ssl: {rejectUnauthorized: false} });

async function run() {
  const q = `
  EXPLAIN ANALYZE 
  SELECT 
    DATE_TRUNC('day', prediction_time) as day, 
    AVG(api_7d) as avg_api
  FROM landslide_predictions
  WHERE prediction_time >= NOW() - INTERVAL '7 days'
  GROUP BY 1
  ORDER BY 1
  `;
  try {
    const res = await pool.query(q);
    console.table(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
