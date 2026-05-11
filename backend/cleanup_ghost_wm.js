'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  console.log('Cleaning up ghost nodes in weather_measurements in batches...')
  const t0 = Date.now()
  let deleted = 0
  
  while (true) {
    const res = await sequelize.query(`
      WITH batch AS (
        SELECT node_id, time 
        FROM weather_measurements
        WHERE node_id NOT IN (
          SELECT node_id FROM grid_nodes WHERE is_weather_station = true
        )
        LIMIT 10000
      )
      DELETE FROM weather_measurements
      WHERE (node_id, time) IN (SELECT node_id, time FROM batch)
      RETURNING 1;
    `)
    const batchCount = res[0].length
    deleted += batchCount
    console.log(`Deleted ${batchCount} rows (Total: ${deleted})`)
    if (batchCount === 0) break
  }

  const c = await sequelize.query(`SELECT COUNT(*) FROM weather_measurements;`, { type: 'SELECT' })
  console.log('weather_measurements count after cleanup:', c[0][0].count)
  console.log('Took', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
