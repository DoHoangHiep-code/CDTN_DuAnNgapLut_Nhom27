'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  await sequelize.query(`
      SELECT
        to_char(date_trunc('hour', (time AT TIME ZONE 'Asia/Ho_Chi_Minh')), 'MM-DD HH24:00') AS date,
        CASE
          WHEN flood_depth_cm <= 10 THEN 'safe'
          WHEN flood_depth_cm <= 20 THEN 'medium'
          WHEN flood_depth_cm <= 40 THEN 'high'
          ELSE 'severe'
        END AS risk_level,
        COUNT(*)::int AS count
      FROM flood_predictions
      WHERE time >= now() - interval '24 hours'
      GROUP BY 1, 2
      ORDER BY 1, 2;
  `, { type: 'SELECT' })
  console.log('Simplified global risk trend took', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
