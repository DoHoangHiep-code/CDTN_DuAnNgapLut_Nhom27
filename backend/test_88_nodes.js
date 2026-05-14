'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  const t0 = Date.now()
  const rows = await sequelize.query(`
    SELECT DISTINCT ON (weather_station_id) node_id
    FROM grid_nodes
    WHERE weather_station_id IS NOT NULL;
  `, { type: 'SELECT' })
  
  const nodeIds = rows.map(r => r.node_id)
  console.log('88 Representative Nodes:', nodeIds.length, 'Took', Date.now() - t0, 'ms')
}
main().catch(console.error).finally(()=>sequelize.close())
