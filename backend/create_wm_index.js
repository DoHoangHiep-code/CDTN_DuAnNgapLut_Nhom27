'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_weather_measurements_time_desc 
    ON weather_measurements ("time" DESC);
  `)
  console.log('Created index in', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
