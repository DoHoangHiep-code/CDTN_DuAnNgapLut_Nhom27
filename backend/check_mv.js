'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const def = await sequelize.query(`
    SHOW CREATE TABLE mv_latest_flood_predictions;
  `, { type: 'SELECT' })
  console.log('MV Definition:', def)
}
main().catch(console.error).finally(()=>sequelize.close())
