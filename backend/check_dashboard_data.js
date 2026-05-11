'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  // 1. Lấy vài node_id thực trong weather_measurements
  const wmSample = await sequelize.query(
    `SELECT DISTINCT node_id FROM weather_measurements LIMIT 5`,
    { type: 'SELECT' }
  )
  console.log('Weather measurements node_ids (sample):', wmSample)

  // 2. Đếm distinct station_ids
  const wmCount = await sequelize.query(
    `SELECT COUNT(DISTINCT node_id) as cnt FROM weather_measurements`,
    { type: 'SELECT' }
  )
  console.log('Distinct node_ids in weather_measurements:', wmCount[0])

  // 3. Lấy risk counts đúng (DISTINCT ON)
  const riskCounts = await sequelize.query(
    `WITH latest AS (
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
      COUNT(*) AS count
    FROM latest
    GROUP BY 1`,
    { type: 'SELECT' }
  )
  console.log('\nRisk counts (DISTINCT nodes, last 24h):', riskCounts)

  // 4. Tổng nodes
  const total = riskCounts.reduce((s, r) => s + Number(r.count), 0)
  console.log('Total unique nodes:', total)

  // 5. Sample weather data
  const weather = await sequelize.query(
    `SELECT AVG(temp) as temp, AVG(rhum) as rhum, AVG(wspd) as wspd
     FROM weather_measurements
     WHERE time >= now() - interval '1 hour'`,
    { type: 'SELECT' }
  )
  console.log('\nGlobal weather (last 1h avg):', weather[0])
}

main().catch(console.error).finally(() => sequelize.close())
