'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function check() {
  const c = await sequelize.query(`SELECT COUNT(*) FROM weather_measurements;`, { type: 'SELECT' })
  console.log('weather_measurements count:', c[0].count)
}
check().catch(console.error).finally(() => sequelize.close())
