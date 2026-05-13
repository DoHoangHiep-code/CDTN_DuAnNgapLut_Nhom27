'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_global_flood_avg AS
    SELECT
      date_trunc('hour', "time") AS bucket_time,
      AVG(flood_depth_cm)::float AS avg_depth
    FROM flood_predictions
    GROUP BY 1;
  `)
  console.log('Created avg MV in', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
