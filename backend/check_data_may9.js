'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const result = await sequelize.query(`
    SELECT COUNT(*) as count 
    FROM flood_predictions 
    WHERE DATE(time) = '2026-05-09' AND flood_depth_cm > 10;
  `)
  console.log('Flooded Data on 2026-05-09:', result[0])
}
main().catch(console.error).finally(()=>sequelize.close())
