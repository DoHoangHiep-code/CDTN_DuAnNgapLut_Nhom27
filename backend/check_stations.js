'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const stationCounts = await sequelize.query(
    `SELECT COUNT(DISTINCT weather_station_id) as c1, COUNT(DISTINCT st1_id) as c2 FROM grid_nodes`,
    { type: 'SELECT' }
  )
  console.log('Distinct stations in grid_nodes:', stationCounts[0])

  const wmMins = await sequelize.query(
    `SELECT MIN(node_id), MAX(node_id) FROM weather_measurements`,
    { type: 'SELECT' }
  )
  console.log('Min/Max node_id in weather_measurements:', wmMins[0])
}
main().catch(console.error).finally(()=>sequelize.close())
