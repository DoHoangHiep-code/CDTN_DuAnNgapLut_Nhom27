'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const wmCols = await sequelize.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'weather_measurements'`,
    { type: 'SELECT' }
  )
  console.log('weather_measurements cols:', wmCols)

  const gnCols = await sequelize.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'grid_nodes'`,
    { type: 'SELECT' }
  )
  console.log('grid_nodes cols:', gnCols)
}
main().catch(console.error).finally(()=>sequelize.close())
