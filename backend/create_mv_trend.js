'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_global_risk_trend AS
    SELECT
      date_trunc('hour', "time") AS bucket_time,
      CASE
        WHEN flood_depth_cm <= 10 THEN 'safe'
        WHEN flood_depth_cm <= 20 THEN 'medium'
        WHEN flood_depth_cm <= 40 THEN 'high'
        ELSE 'severe'
      END AS risk_level,
      COUNT(*)::int AS count
    FROM flood_predictions
    GROUP BY 1, 2;
  `)
  console.log('Created MV in', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
