'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  await sequelize.query(`
      SELECT
        to_char(date_trunc('hour', (time AT TIME ZONE 'Asia/Ho_Chi_Minh')), 'HH24:MI') AS time,
        AVG(flood_depth_cm)::float AS flood_depth_cm
      FROM flood_predictions
      WHERE time >= now() - interval '24 hours'
      GROUP BY 1 ORDER BY 1 LIMIT 24;
  `, { type: 'SELECT' })
  console.log('Global rain forecast (FP) took', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
