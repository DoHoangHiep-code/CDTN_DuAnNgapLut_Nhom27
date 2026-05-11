'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const result = await sequelize.query(
    `SELECT DISTINCT weather_station_id FROM grid_nodes LIMIT 10`,
    { type: 'SELECT' }
  )
  console.log('Sample weather_station_id in grid_nodes:', result)
}
main().catch(console.error).finally(()=>sequelize.close())
