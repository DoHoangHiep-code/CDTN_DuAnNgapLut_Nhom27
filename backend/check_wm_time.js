'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const c = await sequelize.query(`SELECT MIN(time) as min_t, MAX(time) as max_t FROM weather_measurements;`, { type: 'SELECT' })
  console.log('weather_measurements time range:', c[0])
}
main().catch(console.error).finally(()=>sequelize.close())
