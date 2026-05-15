const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const t0 = Date.now();
  const { rows: gnRows } = await pool.query('SELECT * FROM grid_nodes WHERE location_name ILIKE $1 LIMIT 50', ['%Triều Khúc%']);
  console.log('grid_nodes done in', Date.now() - t0, 'ms. Found', gnRows.length);
  if (gnRows.length === 0) process.exit(0);
  const nodeIds = gnRows.map(r => r.node_id);
  
  const t1 = Date.now();
  const sql2 = `
    SELECT DISTINCT ON (node_id) node_id, flood_depth_cm, risk_level, explanation, time
    FROM flood_predictions
    WHERE node_id = ANY($1) AND time >= NOW() - INTERVAL '24 hours'
    ORDER BY node_id, time DESC
  `;
  const { rows: fpRows } = await pool.query(sql2, [nodeIds]);
  console.log('flood_predictions done in', Date.now() - t1, 'ms');
  process.exit(0);
}
run();
