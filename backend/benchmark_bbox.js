'use strict'
require('dotenv').config()

const { sequelize } = require('./src/db/sequelize')
const { QueryTypes } = require('sequelize')

async function main() {
  const t0 = Date.now()

  const rows = await sequelize.query(
    `SELECT
       gn.node_id, gn.latitude, gn.longitude,
       mv.risk_level, mv.flood_depth_cm
     FROM mv_latest_flood_predictions mv
     JOIN grid_nodes gn ON gn.node_id = mv.node_id
     WHERE mv.flood_depth_cm > 10
       AND gn.latitude  BETWEEN 20.95 AND 21.10
       AND gn.longitude BETWEEN 105.75 AND 105.95
     ORDER BY mv.flood_depth_cm DESC
     LIMIT 2000`,
    { type: QueryTypes.SELECT }
  )

  const elapsed = Date.now() - t0
  console.log(`\n✅ BBox Query kết quả:`)
  console.log(`   Thời gian   : ${elapsed} ms`)
  console.log(`   Số rows     : ${rows.length}`)
  if (rows.length > 0) {
    console.log(`   Ví dụ row 1 : depth=${rows[0].flood_depth_cm}cm`)
  }
}

main().catch(console.error).finally(() => sequelize.close())
