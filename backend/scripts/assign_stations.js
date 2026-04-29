'use strict'

/**
 * scripts/assign_stations.js — Bước 3: Phân cụm không gian
 * ─────────────────────────────────────────────────────────────────────────────
 * Gán `weather_station_id` cho 53.291 GridNode dựa trên trạm gần nhất
 * theo khoảng cách Euclidean (lat, lon).
 *
 * CHẠY 1 LẦN (idempotent — có thể chạy lại nếu thêm trạm mới):
 *   cd backend && node scripts/assign_stations.js
 *
 * Thời gian ước tính: ~15-30s (update 53K rows, batch 1000/lần)
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config()

const { sequelize, Sequelize } = require('../src/db/sequelize')
const { QueryTypes } = require('sequelize')
require('../src/models/index')
const { GridNode } = require('../src/models')
const STATIONS = require('../config/weatherStations')

const BATCH_SIZE = 1000

// ─── Hàm tính trạm gần nhất (Euclidean 2D) ────────────────────────────────────

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {number} station.id của trạm gần nhất
 */
function nearestStationId(lat, lon) {
  let bestId   = STATIONS[0].id
  let bestDist = Infinity

  for (const s of STATIONS) {
    const dLat  = lat - s.lat
    const dLon  = lon - s.lon
    const dist2 = dLat * dLat + dLon * dLon  // bình phương khoảng cách (không cần sqrt)
    if (dist2 < bestDist) {
      bestDist = dist2
      bestId   = s.id
    }
  }

  return bestId
}

// ─── Hàm chính ────────────────────────────────────────────────────────────────

async function assignStations() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT – Gán Trạm Thời Tiết Đại Diện (Spatial Cluster) ║')
  console.log(`║   Số trạm: ${STATIONS.length} | Batch: ${BATCH_SIZE} rows/lần                     ║`)
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  console.log('[Trạm] Danh sách trạm đại diện:')
  STATIONS.forEach((s) => console.log(`  [${s.id}] ${s.name} (${s.lat}, ${s.lon})`))
  console.log('')

  // Kết nối DB
  try {
    await sequelize.authenticate()
    console.log('[DB] ✅ Kết nối Supabase thành công.')
  } catch (err) {
    console.error('[DB] ❌ Kết nối thất bại:', err.message)
    process.exit(1)
  }

  // Sync schema để cột weather_station_id được tạo nếu chưa có
  await sequelize.sync({ alter: true })
  console.log('[DB] ✅ Schema sync OK.\n')

  // Lấy toàn bộ nodes (chỉ cần node_id, lat, lon)
  console.log('[Query] Đang lấy danh sách GridNode...')
  const nodes = await GridNode.findAll({
    attributes: ['node_id', 'latitude', 'longitude'],
    raw: true,
  })
  console.log(`[Query] ✅ Tổng: ${nodes.length.toLocaleString('vi-VN')} nodes.\n`)

  // Tính station cho từng node và nhóm theo station_id
  const startTime  = Date.now()
  let totalUpdated = 0
  let processed    = 0
  let batchNum     = 0

  // Nhóm nodes theo station_id để tạo batch SQL UPDATE
  const stationMap = new Map()
  for (const node of nodes) {
    const stationId = nearestStationId(Number(node.latitude), Number(node.longitude))
    if (!stationMap.has(stationId)) stationMap.set(stationId, [])
    stationMap.get(stationId).push(node.node_id)
  }

  for (const [stationId, nodeIds] of stationMap.entries()) {
    // Gi\u1ea3m BATCH_SIZE xu\u1ed1ng 500 \u0111\u1ec3 tham s\u1ed1 trong unnest() kh\u00f4ng qu\u00e1 d\u00e0i
    const LOCAL_BATCH = 500
    for (let i = 0; i < nodeIds.length; i += LOCAL_BATCH) {
      batchNum++
      const chunk = nodeIds.slice(i, i + LOCAL_BATCH)
      try {
        // Sequelize kh\u00f4ng serialize m\u1ea3ng s\u1ed1 \u0111\u00fang cho ANY() \u2192 d\u00f9ng unnest() cast r\u00f5 INTEGER[]
        // V\u00ed d\u1ee5: WHERE node_id = ANY(ARRAY[1,2,3]::BIGINT[])
        const idList = chunk.join(',')
        await sequelize.query(
          `UPDATE grid_nodes SET weather_station_id = ${stationId} WHERE node_id IN (${idList})`,
          { type: QueryTypes.UPDATE }
        )
        totalUpdated += chunk.length
        processed    += chunk.length
        const pct = ((processed / nodes.length) * 100).toFixed(1)
        console.log(`[Batch ${batchNum}] \u2705 Tr\u1ea1m ${stationId} \u2013 ${chunk.length} rows | T\u1ed5ng: ${totalUpdated.toLocaleString('vi-VN')} | ${pct}%`)
      } catch (err) {
        console.error(`[Batch ${batchNum}] \u274c L\u1ed7i tr\u1ea1m ${stationId}: ${err.message}`)
      }
    }
  }

  // Thống kê phân bố
  console.log('\n[Thống kê] Phân bố nodes theo trạm:')
  const counts = new Map(STATIONS.map((s) => [s.id, { name: s.name, count: 0 }]))
  for (const node of nodes) {
    const stationId = nearestStationId(Number(node.latitude), Number(node.longitude))
    if (counts.has(stationId)) counts.get(stationId).count++
  }
  counts.forEach((v, k) => {
    const bar = '█'.repeat(Math.round(v.count / nodes.length * 40))
    console.log(`  [${k}] ${v.name.padEnd(30)} ${v.count.toLocaleString('vi-VN').padStart(7)} nodes  ${bar}`)
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(`✅  HOÀN THÀNH`)
  console.log(`    Tổng nodes cập nhật : ${totalUpdated.toLocaleString('vi-VN')}`)
  console.log(`    Thời gian           : ${elapsed}s`)
  console.log('──────────────────────────────────────────────────────────────')
  console.log('\n📋 Kiểm tra trên Supabase SQL Editor:')
  console.log('    SELECT weather_station_id, COUNT(*) AS node_count')
  console.log('    FROM grid_nodes')
  console.log('    GROUP BY weather_station_id')
  console.log('    ORDER BY weather_station_id;')

  await sequelize.close()
  process.exit(0)
}

assignStations().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
