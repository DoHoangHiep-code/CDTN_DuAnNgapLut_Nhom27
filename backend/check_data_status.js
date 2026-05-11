'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  // Check data counts & date ranges
  const [fpRange] = await sequelize.query(`SELECT MIN(time), MAX(time), COUNT(*) FROM flood_predictions`)
  const [wmRange] = await sequelize.query(`SELECT MIN(time), MAX(time), COUNT(*) FROM weather_measurements`)
  const [mvCount] = await sequelize.query(`SELECT COUNT(*), AVG(flood_depth_cm) FROM mv_latest_flood_predictions`)

  console.log('\n=== DATA STATUS ===')
  console.log('flood_predictions:', fpRange[0])
  console.log('weather_measurements:', wmRange[0])
  console.log('mv_latest_flood_predictions:', mvCount[0])
  
  await sequelize.close()
}
main().catch(console.error)
