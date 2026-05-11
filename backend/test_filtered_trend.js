'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  await sequelize.query(`
      WITH max_per_bucket AS (
        SELECT
          to_char(date_trunc('hour', (time AT TIME ZONE 'Asia/Ho_Chi_Minh')), 'MM-DD HH24:00') AS date,
          node_id,
          MAX(flood_depth_cm) as max_depth
        FROM flood_predictions
        WHERE time >= now() - interval '24 hours'
          AND node_id BETWEEN 200000 AND 200500
        GROUP BY 1, 2
      )
      SELECT
        date,
        CASE
          WHEN max_depth <= 10 THEN 'safe'
          WHEN max_depth <= 20 THEN 'medium'
          WHEN max_depth <= 40 THEN 'high'
          ELSE 'severe'
        END AS risk_level,
        COUNT(*)::int AS count
      FROM max_per_bucket
      GROUP BY 1, 2
      ORDER BY 1, 2;
  `, { type: 'SELECT' })
  console.log('Filtered risk trend took', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
