'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const allData = await sequelize.query(`
    SELECT COUNT(*) as count, MAX(time) as max_time, MIN(time) as min_time 
    FROM flood_predictions;
  `)
  console.log('Overall Data:', allData[0])

  const may9Data = await sequelize.query(`
    SELECT COUNT(*) as count, MAX(time) as max_time, MIN(time) as min_time 
    FROM flood_predictions 
    WHERE DATE(time) = '2026-05-09';
  `)
  console.log('Data on 2026-05-09:', may9Data[0])

  const sep5Data = await sequelize.query(`
    SELECT COUNT(*) as count, MAX(time) as max_time, MIN(time) as min_time 
    FROM flood_predictions 
    WHERE DATE(time) = '2026-09-05';
  `)
  console.log('Data on 2026-09-05:', sep5Data[0])

  const sep5FloodedData = await sequelize.query(`
    SELECT COUNT(*) as count
    FROM flood_predictions 
    WHERE DATE(time) = '2026-09-05' AND flood_depth_cm > 10;
  `)
  console.log('Flooded Data on 2026-09-05:', sep5FloodedData[0])
}
main().catch(console.error).finally(()=>sequelize.close())
