'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  await sequelize.query(`
      SELECT
        CASE
          WHEN flood_depth_cm <= 10 THEN 'safe'
          WHEN flood_depth_cm <= 20 THEN 'medium'
          WHEN flood_depth_cm <= 40 THEN 'high'
          ELSE 'severe'
        END AS risk_level,
        COUNT(*)::int AS count
      FROM mv_latest_flood_predictions
      GROUP BY 1;
  `, { type: 'SELECT' })
  console.log('Global risk counts from MV took', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
