require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function test() {
  try {
    const { rows } = await pool.query(
      `WITH LatestTimes AS (
         SELECT DISTINCT prediction_time 
         FROM landslide_predictions 
         WHERE risk_level IS NOT NULL 
         ORDER BY prediction_time DESC 
         LIMIT 4
       )
       SELECT p.node_id, p.prob_landslide, p.risk_level, p.rain_7d_accum, p.api_7d, p.soil_moisture_1d, p.prediction_time, n.province, n.lat, n.lon, n.location_name, n.slope, n.elevation
       FROM landslide_predictions p
       JOIN landslide_grid_nodes n ON p.node_id = n.node_id
       JOIN LatestTimes lt ON p.prediction_time = lt.prediction_time
       ORDER BY p.prediction_time ASC
       LIMIT 10`
    );
    console.log("Success:", rows.length);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    pool.end();
  }
}

test();
