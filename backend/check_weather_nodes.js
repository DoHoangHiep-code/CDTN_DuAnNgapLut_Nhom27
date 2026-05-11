'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const result = await sequelize.query(
    `SELECT node_id, count(*) FROM weather_measurements GROUP BY node_id LIMIT 5`,
    { type: 'SELECT' }
  )
  console.log('Sample node_ids in weather_measurements:', result)
}
main().catch(console.error).finally(()=>sequelize.close())
