'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const tz = 'Asia/Ho_Chi_Minh'
  const fmt = 'DD/MM'
  const h = 168

  // 1) Check MV date range
  const [range] = await sequelize.query(
    `SELECT MIN(bucket_time) AS min_t, MAX(bucket_time) AS max_t, COUNT(*) AS cnt FROM mv_global_risk_trend`
  )
  console.log('MV range:', range[0])

  // 2) Without hourFilter
  const [rows1] = await sequelize.query(
    `SELECT to_char(bucket_time AT TIME ZONE '${tz}', '${fmt}') AS date, risk_level, count
     FROM mv_global_risk_trend
     WHERE bucket_time >= now() - interval '24 hours'
       AND bucket_time <= now() + interval '${h} hours'
     ORDER BY bucket_time ASC LIMIT 10`
  )
  console.log('Without hourFilter:', rows1.length, 'rows')
  console.log(rows1)

  // 3) With hourFilter = 12
  const [rows2] = await sequelize.query(
    `SELECT to_char(bucket_time AT TIME ZONE '${tz}', '${fmt}') AS date, risk_level, count
     FROM mv_global_risk_trend
     WHERE bucket_time >= now() - interval '24 hours'
       AND bucket_time <= now() + interval '${h} hours'
       AND extract(hour from bucket_time AT TIME ZONE '${tz}') = 12
     ORDER BY bucket_time ASC LIMIT 10`
  )
  console.log('With hourFilter (=12):', rows2.length, 'rows')
  console.log(rows2)

  // 4) Also check: what does the flood_predictions table have for recent data?
  const [fpRange] = await sequelize.query(
    `SELECT MIN(time) AS min_t, MAX(time) AS max_t, COUNT(*) AS cnt FROM flood_predictions`
  )
  console.log('flood_predictions range:', fpRange[0])
}

main().catch(console.error).finally(() => sequelize.close())
