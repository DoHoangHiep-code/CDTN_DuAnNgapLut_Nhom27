'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  console.log('Deleting old weather measurements > 7 days...')
  const t0 = Date.now()
  await sequelize.query(`
    DELETE FROM weather_measurements
    WHERE "time" < now() - interval '7 days';
  `)
  console.log('Deleted in', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
