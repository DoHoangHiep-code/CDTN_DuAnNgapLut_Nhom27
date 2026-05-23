const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL, ssl: {rejectUnauthorized: false} });

async function run() {
  const q = `
  EXPLAIN ANALYZE 
  WITH latest_time AS (SELECT MAX(prediction_time) as pt FROM landslide_predictions) 
  SELECT n.province, 
         SUM(CASE WHEN p.risk_level = 'DANGER' THEN 1 ELSE 0 END) as danger, 
         SUM(CASE WHEN p.risk_level = 'WARNING' THEN 1 ELSE 0 END) as warning 
  FROM landslide_predictions p 
  JOIN landslide_grid_nodes n ON p.node_id = n.node_id 
  WHERE p.prediction_time = (SELECT pt FROM latest_time) 
    AND p.risk_level IN ('DANGER', 'WARNING') 
  GROUP BY n.province 
  ORDER BY danger DESC, warning DESC 
  LIMIT 5;
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
