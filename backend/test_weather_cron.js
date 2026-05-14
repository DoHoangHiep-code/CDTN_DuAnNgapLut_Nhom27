'use strict'
require('dotenv').config()
const { manualTrigger } = require('./src/services/weatherCron')
const { sequelize } = require('./src/db/sequelize')

async function main() {
  console.log('Testing weatherCron.js manualTrigger...')
  await manualTrigger()
  console.log('Done testing weatherCron.js')
}
main().catch(console.error).finally(()=>sequelize.close())
