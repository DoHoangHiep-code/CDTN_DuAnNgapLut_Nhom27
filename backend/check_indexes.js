'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const indexes = await sequelize.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'flood_predictions';
  `, { type: 'SELECT' })
  console.log('Indexes on flood_predictions:', indexes)
}
main().catch(console.error).finally(()=>sequelize.close())
