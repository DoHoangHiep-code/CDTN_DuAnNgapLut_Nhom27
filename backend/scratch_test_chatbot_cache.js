require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function test() {
  try {
    const sqlCurrent = `
      SELECT sub.node_id, sub.prob_landslide, sub.risk_level, sub.prediction_time,
             gn.location_name, gn.province, gn.lat, gn.lon, gn.slope, gn.elevation,
             sub.rain_1d_accum, sub.rain_7d_accum, sub.api_7d, sub.api_14d, sub.soil_moisture_1d, sub.soil_moisture_7d
      FROM (
        SELECT DISTINCT ON (node_id) *
        FROM landslide_predictions
        WHERE prediction_time >= NOW() - INTERVAL '24 hours'
          AND risk_level IN ('DANGER', 'WARNING')
        ORDER BY node_id, prediction_time DESC
      ) sub
      JOIN landslide_grid_nodes gn ON gn.node_id = sub.node_id
      ORDER BY sub.prob_landslide DESC
      LIMIT 10
    `;
    const resCurrent = await pool.query(sqlCurrent);
    console.log("Current status:", resCurrent.rows.length);

    const sqlWorst = `
      SELECT sub.node_id, sub.prob_landslide, sub.risk_level, sub.prediction_time,
             gn.location_name, gn.province, gn.lat, gn.lon, gn.slope, gn.elevation,
             sub.rain_1d_accum, sub.rain_7d_accum, sub.api_7d, sub.api_14d, sub.soil_moisture_1d, sub.soil_moisture_7d
      FROM (
        SELECT DISTINCT ON (node_id) *
        FROM landslide_predictions
        WHERE prediction_time >= NOW() - INTERVAL '24 hours'
        ORDER BY node_id, prob_landslide DESC, prediction_time DESC
      ) sub
      JOIN landslide_grid_nodes gn ON gn.node_id = sub.node_id
      ORDER BY sub.prob_landslide DESC
      LIMIT 5
    `;
    const resWorst = await pool.query(sqlWorst);
    console.log("Worst areas:", resWorst.rows.length);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    pool.end();
  }
}

test();
