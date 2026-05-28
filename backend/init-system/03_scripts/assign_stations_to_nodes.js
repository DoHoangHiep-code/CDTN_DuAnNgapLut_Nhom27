'use strict'

/**
 * init-system/03_scripts/assign_stations_to_nodes.js
 * ────────────────────────────────────────────────────────────────────────────
 * Gán weather_station_id cho từng grid_node dựa trên trạm ảo gần nhất.
 * Dùng PostGIS ST_Distance để tính khoảng cách chính xác.
 * Script này chạy sau setup_virtual_stations.js nếu có node bị null.
 * ────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') })

const { sequelize } = require('../../src/db/sequelize')
const { QueryTypes } = require('sequelize')

async function main() {
  console.log('\n[AssignStations] Bắt đầu gán weather_station_id cho grid_nodes...')
  await sequelize.authenticate()
  console.log('[DB] ✅ Kết nối thành công.')

  // Kiểm tra xem có node nào chưa được gán không
  const [[before]] = await sequelize.query(`
    SELECT COUNT(*) as total,
           COUNT(weather_station_id) as assigned,
           COUNT(*) - COUNT(weather_station_id) as still_null
    FROM grid_nodes
  `)
  console.log(`\n📊 Trước: Total=${before.total} | Assigned=${before.assigned} | NULL=${before.still_null}`)

  if (parseInt(before.still_null) === 0) {
    console.log('✅ Tất cả nodes đã có station. Bỏ qua.')
    await sequelize.close()
    return
  }

  console.log(`\n🔄 Đang gán cho ${before.still_null} nodes còn NULL (dùng PostGIS nearest neighbor)...`)

  await sequelize.query(`
    UPDATE grid_nodes gn
    SET weather_station_id = closest.station_id
    FROM (
      SELECT DISTINCT ON (gn2.node_id)
             gn2.node_id,
             ws.id AS station_id
      FROM grid_nodes gn2
      CROSS JOIN weather_stations ws
      WHERE gn2.weather_station_id IS NULL
      ORDER BY gn2.node_id,
               ST_Distance(
                 ST_SetSRID(ST_MakePoint(gn2.longitude::double precision, gn2.latitude::double precision), 4326)::geography,
                 ST_SetSRID(ST_MakePoint(ws.longitude::double precision, ws.latitude::double precision), 4326)::geography
               ) ASC
    ) AS closest
    WHERE gn.node_id = closest.node_id
    AND gn.weather_station_id IS NULL
  `, { type: QueryTypes.UPDATE })

  console.log('✅ Đã gán xong weather_station_id.')

  // Kiểm tra kết quả
  const [[after]] = await sequelize.query(`
    SELECT COUNT(*) as total,
           COUNT(weather_station_id) as assigned,
           COUNT(*) - COUNT(weather_station_id) as still_null
    FROM grid_nodes
  `)
  console.log(`📊 Sau:   Total=${after.total} | Assigned=${after.assigned} | NULL=${after.still_null}\n`)

  await sequelize.close()
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
