require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function test() {
  try {
    console.log("Running full query...");
    const { rows } = await pool.query(
      `WITH LatestTimes AS (
         SELECT DISTINCT prediction_time 
         FROM landslide_predictions 
         WHERE risk_level IS NOT NULL 
         ORDER BY prediction_time DESC 
         LIMIT 4
       )
       SELECT COUNT(*) as cnt
       FROM landslide_predictions p
       JOIN landslide_grid_nodes n ON p.node_id = n.node_id
       JOIN LatestTimes lt ON p.prediction_time = lt.prediction_time`
    );
    console.log("Success count:", rows[0].cnt);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    pool.end();
  }
}

test();
