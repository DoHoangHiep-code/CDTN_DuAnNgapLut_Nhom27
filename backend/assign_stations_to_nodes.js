/**
 * assign_stations_to_nodes.js
 * Gán weather_station_id cho từng grid_node dựa trên trạm ảo gần nhất (nearest neighbor)
 * Dùng PostGIS ST_Distance để tính khoảng cách nhanh.
 */
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  console.log('🔄 Bắt đầu gán weather_station_id cho grid_nodes...')

  const [result] = await sequelize.query(`
    UPDATE grid_nodes gn
    SET weather_station_id = closest.station_id
    FROM (
      SELECT DISTINCT ON (gn2.node_id)
             gn2.node_id,
             ws.id AS station_id
      FROM grid_nodes gn2
      CROSS JOIN weather_stations ws
      ORDER BY gn2.node_id,
               ST_Distance(
                 ST_SetSRID(ST_MakePoint(gn2.longitude::double precision, gn2.latitude::double precision), 4326)::geography,
                 ST_SetSRID(ST_MakePoint(ws.longitude::double precision, ws.latitude::double precision), 4326)::geography
               ) ASC
    ) AS closest
    WHERE gn.node_id = closest.node_id
    AND gn.weather_station_id IS NULL
  `)

  console.log('✅ Đã gán xong weather_station_id cho tất cả grid_nodes.')

  // Kiểm tra kết quả
  const [[check]] = await sequelize.query(`
    SELECT COUNT(*) as total,
           COUNT(weather_station_id) as assigned,
           COUNT(*) - COUNT(weather_station_id) as still_null
    FROM grid_nodes
  `)
  console.log(`📊 Total: ${check.total} | Assigned: ${check.assigned} | Still NULL: ${check.still_null}`)

  await sequelize.close()
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
