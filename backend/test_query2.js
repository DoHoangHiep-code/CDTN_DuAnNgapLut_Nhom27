const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const t0 = Date.now();
  const sql = `
      SELECT DISTINCT ON (fp.node_id)
        gn.node_id, gn.location_name,
        fp.flood_depth_cm, fp.risk_level::text AS risk_level, fp.time
      FROM flood_predictions fp
      JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE fp.time >= NOW() - INTERVAL '24 hours'
        AND gn.location_name ILIKE $1
      ORDER BY fp.node_id, fp.time DESC
  `;
  const { rows } = await pool.query(sql, ['%Triều Khúc%']);
  console.log('Query done in', Date.now() - t0, 'ms');
  console.log(rows);
  process.exit(0);
}
run();
