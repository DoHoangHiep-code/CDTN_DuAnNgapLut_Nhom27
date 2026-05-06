'use strict'

/**
 * generate_virtual_stations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sinh ~350–400 trạm thời tiết ảo bằng cách chia bản đồ Hà Nội
 * thành các ô lưới 3km × 3km, lấy tâm ô làm tọa độ trạm ảo.
 *
 * Kết quả INSERT vào bảng `weather_stations`.
 *
 * Chạy 1 lần sau khi import xong 53K grid_nodes:
 *   node scripts/generate_virtual_stations.js
 */

require('dotenv').config()
const { sequelize } = require('../src/db/sequelize')
const { WeatherStation, GridNode } = require('../src/models')

// ─── Cấu hình lưới Hà Nội ────────────────────────────────────────────────────
// Bounding box rộng bao phủ toàn bộ grid Hà Nội (±margin)
const HANOI_BBOX = {
  minLat: 20.55,
  maxLat: 21.40,
  minLon: 105.25,
  maxLon: 106.05,
}

// 3km ≈ 0.02698° lat, 0.03396° lon tại vĩ độ 21°
const GRID_SIZE_LAT = 3 / 111.0         // ~0.02703°
const GRID_SIZE_LON = 3 / (111.0 * Math.cos(21 * Math.PI / 180))  // ~0.02894°

// ─── Helper: tính khoảng cách Haversine (km) ─────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function main() {
  console.log('\n[GenerateStations] Bắt đầu sinh lưới trạm ảo 3x3km...')

  // 1. Đọc toàn bộ grid_nodes từ DB
  const nodes = await GridNode.findAll({
    attributes: ['node_id', 'latitude', 'longitude'],
    raw: true,
  })
  console.log(`[GenerateStations] Đọc được ${nodes.length.toLocaleString('vi-VN')} grid_nodes.`)

  if (!nodes.length) {
    console.error('[GenerateStations] ❌ Không có node nào. Hãy import CSV trước.')
    process.exit(1)
  }

  // 2. Build lookup nhanh
  const nodesAsFloat = nodes.map(n => ({
    node_id: Number(n.node_id),
    lat: parseFloat(n.latitude),
    lon: parseFloat(n.longitude),
  }))

  // 3. Tính số hàng/cột lưới
  const nRows = Math.ceil((HANOI_BBOX.maxLat - HANOI_BBOX.minLat) / GRID_SIZE_LAT)
  const nCols = Math.ceil((HANOI_BBOX.maxLon - HANOI_BBOX.minLon) / GRID_SIZE_LON)
  console.log(`[GenerateStations] Lưới: ${nRows} hàng × ${nCols} cột = ${nRows * nCols} ô tối đa.`)

  // 4. Với mỗi ô lưới, tìm node gần tâm ô nhất → làm trạm ảo
  const stations = []
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const centLat = HANOI_BBOX.minLat + (r + 0.5) * GRID_SIZE_LAT
      const centLon = HANOI_BBOX.minLon + (c + 0.5) * GRID_SIZE_LON

      // Tìm node gần tâm ô nhất (brute-force, chạy offline nên OK)
      let best = null
      let bestDist = Infinity
      for (const n of nodesAsFloat) {
        const d = haversineKm(centLat, centLon, n.lat, n.lon)
        if (d < bestDist) {
          bestDist = d
          best = n
        }
      }

      // Chỉ tạo trạm nếu có ít nhất 1 node trong ô (bán kính ~2.5km)
      if (best && bestDist <= 2.5) {
        stations.push({
          name:       `VS_R${r}_C${c}`,
          latitude:   parseFloat(centLat.toFixed(6)),
          longitude:  parseFloat(centLon.toFixed(6)),
          node_count: 0,   // sẽ update sau
          grid_row:   r,
          grid_col:   c,
        })
      }
    }
  }
  console.log(`[GenerateStations] Sinh được ${stations.length} trạm ảo hợp lệ (có node trong bán kính 2.5km).`)

  // 5. Clear bảng cũ và INSERT hàng loạt
  console.log('[GenerateStations] Đang xóa trạm cũ...')
  await WeatherStation.destroy({ truncate: true, cascade: false })

  console.log('[GenerateStations] Đang INSERT trạm mới...')
  const BATCH = 100
  let inserted = 0
  for (let i = 0; i < stations.length; i += BATCH) {
    await WeatherStation.bulkCreate(stations.slice(i, i + BATCH))
    inserted += Math.min(BATCH, stations.length - i)
    process.stdout.write(`\r  Đã chèn: ${inserted}/${stations.length}`)
  }
  console.log()

  console.log(`\n[GenerateStations] ✅ Hoàn thành! ${inserted} trạm ảo đã được tạo.`)
  console.log('[GenerateStations] Bước tiếp theo: node scripts/calculate_idw_weights.js')
}

main()
  .catch(err => {
    console.error('[GenerateStations] ❌ Lỗi:', err.message)
    process.exit(1)
  })
  .finally(() => sequelize.close())
