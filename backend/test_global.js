'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  await sequelize.query(`
      WITH latest AS (
        SELECT DISTINCT ON (node_id) node_id, flood_depth_cm
        FROM flood_predictions
        WHERE time >= now() - interval '24 hours'
        ORDER BY node_id, time DESC
      )
      SELECT
        CASE
          WHEN flood_depth_cm <= 10 THEN 'safe'
          WHEN flood_depth_cm <= 20 THEN 'medium'
          WHEN flood_depth_cm <= 40 THEN 'high'
          ELSE 'severe'
        END AS risk_level,
        COUNT(*)::int AS count
      FROM latest
      GROUP BY 1;
  `, { type: 'SELECT' })
  console.log('Global risk counts took', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
