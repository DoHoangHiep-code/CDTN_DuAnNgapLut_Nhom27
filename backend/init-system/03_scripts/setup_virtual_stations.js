'use strict'

/**
 * setup_virtual_stations.js  – v3 (FULL REWRITE)
 * ──────────────────────────────────────────────────────────────────────────────
 * Bước 1 – Đọc toàn bộ grid_nodes từ DB, tính Bounding Box thực tế.
 * Bước 2 – Chia lưới 3km × 3km, lấy tâm ô làm Trạm Ảo.
 * Bước 3 – Haversine mapping: gán trạm gần nhất cho mỗi node → đếm node_count.
 * Bước 4 – Orphan Filter: chỉ INSERT trạm có node_count > 0 vào DB.
 * Bước 5 – Cập nhật weather_station_id của 53K grid_nodes.
 * ──────────────────────────────────────────────────────────────────────────────
 * Chạy: node scripts/setup_virtual_stations.js
 */

require('dotenv').config()

const { sequelize } = require('../src/db/sequelize')
const { WeatherStation, GridNode } = require('../src/models')
const { QueryTypes } = require('sequelize')

// ─── Cấu hình lưới ────────────────────────────────────────────────────────────
const GRID_KM      = 3          // kích thước ô lưới (km)
const GRID_DEG_LAT = GRID_KM / 111.0                             // ~0.02703°
const GRID_DEG_LON = GRID_KM / (111.0 * Math.cos(21 * Math.PI / 180)) // ~0.02894°
const MARGIN_DEG   = GRID_KM / 111.0 * 0.5  // margin ngoài bbox 0.5 ô

// ─── Haversine (km) ───────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT – Setup Trạm Ảo 3x3km (v3 Full Rewrite)         ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  await sequelize.authenticate()
  console.log('[DB] ✅ Kết nối thành công.\n')

  // ── Bước 1: Đọc toàn bộ nodes ─────────────────────────────────────────────
  console.log('[Bước 1] Đang đọc toàn bộ grid_nodes...')
  const nodes = await GridNode.findAll({
    attributes: ['node_id', 'latitude', 'longitude'],
    raw: true,
  })
  const N = nodes.length
  console.log(`[Bước 1] ✅ ${N.toLocaleString('vi-VN')} nodes đã tải.\n`)

  if (!N) { console.error('❌ Không có node nào. Import CSV trước.'); process.exit(1) }

  const nodesF = nodes.map(n => ({
    node_id: String(n.node_id),
    lat: parseFloat(n.latitude),
    lon: parseFloat(n.longitude),
  }))

  // ── Bước 2: Tính Bounding Box và sinh lưới ────────────────────────────────
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const n of nodesF) {
    if (n.lat < minLat) minLat = n.lat
    if (n.lat > maxLat) maxLat = n.lat
    if (n.lon < minLon) minLon = n.lon
    if (n.lon > maxLon) maxLon = n.lon
  }
  console.log(`[Bước 2] Bounding Box: lat [${minLat.toFixed(4)}, ${maxLat.toFixed(4)}] | lon [${minLon.toFixed(4)}, ${maxLon.toFixed(4)}]`)

  // Mở rộng bbox thêm margin 0.5 ô để không bỏ sót node rìa
  minLat -= MARGIN_DEG; maxLat += MARGIN_DEG
  minLon -= MARGIN_DEG; maxLon += MARGIN_DEG

  const nRows = Math.ceil((maxLat - minLat) / GRID_DEG_LAT)
  const nCols = Math.ceil((maxLon - minLon) / GRID_DEG_LON)
  console.log(`[Bước 2] Lưới tối đa: ${nRows} hàng × ${nCols} cột = ${nRows * nCols} ô\n`)

  // Tạo danh sách ô lưới tiềm năng (tâm mỗi ô)
  const candidateStations = []
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const centLat = minLat + (r + 0.5) * GRID_DEG_LAT
      const centLon = minLon + (c + 0.5) * GRID_DEG_LON
      candidateStations.push({
        grid_row: r,
        grid_col: c,
        lat: centLat,
        lon: centLon,
        nodeCount: 0,
      })
    }
  }

  // ── Bước 3: Mapping mỗi node → trạm gần nhất (Haversine) ─────────────────
  console.log(`[Bước 3] Đang mapping ${N.toLocaleString('vi-VN')} nodes → trạm gần nhất...`)
  const nodeStationMap = new Map()   // node_id → station index trong candidateStations

  // Index nhanh: mỗi node thuộc ô nào theo lat/lon
  // Thay vì brute-force O(N×M), dùng grid-cell lookup O(N)
  const stationIndexMap = new Map() // key: `${r}_${c}` → index trong candidateStations
  candidateStations.forEach((s, idx) => stationIndexMap.set(`${s.grid_row}_${s.grid_col}`, idx))

  for (const node of nodesF) {
    // Tìm ô lưới mà node có thể rơi vào (cell chính và 8 ô lân cận)
    const rEst = Math.floor((node.lat - minLat) / GRID_DEG_LAT)
    const cEst = Math.floor((node.lon - minLon) / GRID_DEG_LON)

    let bestIdx = -1
    let bestDist = Infinity

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = rEst + dr
        const c = cEst + dc
        const idx = stationIndexMap.get(`${r}_${c}`)
        if (idx === undefined) continue
        const s = candidateStations[idx]
        const d = haversineKm(node.lat, node.lon, s.lat, s.lon)
        if (d < bestDist) { bestDist = d; bestIdx = idx }
      }
    }

    // Fallback: nếu không tìm thấy trong 9 ô lân cận (node ngoài margin), tìm toàn bộ
    if (bestIdx === -1) {
      for (let idx = 0; idx < candidateStations.length; idx++) {
        const s   = candidateStations[idx]
        const d   = haversineKm(node.lat, node.lon, s.lat, s.lon)
        if (d < bestDist) { bestDist = d; bestIdx = idx }
      }
    }

    if (bestIdx !== -1) {
      nodeStationMap.set(node.node_id, bestIdx)
      candidateStations[bestIdx].nodeCount++
    }
  }

  // ── Bước 4: Orphan Filter – chỉ giữ trạm có nodeCount > 0 ────────────────
  const validStations = candidateStations.filter(s => s.nodeCount > 0)
  const orphanCount   = candidateStations.length - validStations.length
  console.log(`[Bước 4] ✅ Trạm hợp lệ (node_count > 0): ${validStations.length}`)
  console.log(`[Bước 4]    Trạm rỗng bị loại (orphans):  ${orphanCount}`)
  console.log(`[Bước 4]    → Chỉ ${validStations.length} trạm được lưu vào DB.\n`)

  // ── Bước 5: INSERT trạm vào DB (xóa cũ trước) ────────────────────────────
  console.log('[Bước 5] Đang xóa tất cả trạm cũ...')
  await WeatherStation.destroy({ truncate: true, cascade: false })

  console.log(`[Bước 5] Đang INSERT ${validStations.length} trạm hợp lệ...`)
  const BATCH = 100
  const insertedStations = []
  for (let i = 0; i < validStations.length; i += BATCH) {
    const chunk = validStations.slice(i, i + BATCH).map(s => ({
      name:       `VS_R${s.grid_row}_C${s.grid_col}`,
      latitude:   parseFloat(s.lat.toFixed(6)),
      longitude:  parseFloat(s.lon.toFixed(6)),
      node_count: s.nodeCount,
      grid_row:   s.grid_row,
      grid_col:   s.grid_col,
    }))
    const created = await WeatherStation.bulkCreate(chunk, { returning: true })
    insertedStations.push(...created)
    process.stdout.write(`\r  Đã insert: ${Math.min(i + BATCH, validStations.length)}/${validStations.length}`)
  }
  console.log('\n[Bước 5] ✅ Tất cả trạm đã được lưu vào DB.\n')

  // Build reverse lookup: candidateStation index → DB station id
  // insertedStations được trả về theo thứ tự insert (= thứ tự validStations)
  const validIndexToDbId = new Map()
  validStations.forEach((s, i) => {
    const dbSt = insertedStations[i]
    if (dbSt) validIndexToDbId.set(candidateStations.indexOf(s), dbSt.id)
  })

  // ── Bước 6: Update weather_station_id cho 53K nodes (batch UPDATE) ────────
  console.log('[Bước 6] Đang cập nhật weather_station_id cho toàn bộ grid_nodes...')

  // Group nodes by station DB id để batch update
  const stationNodeGroups = new Map() // dbStationId → [node_id, ...]
  for (const [nodeId, candIdx] of nodeStationMap.entries()) {
    const dbId = validIndexToDbId.get(candIdx)
    if (!dbId) continue
    if (!stationNodeGroups.has(dbId)) stationNodeGroups.set(dbId, [])
    stationNodeGroups.get(dbId).push(nodeId)
  }

  let totalUpdated = 0
  const UPDATE_CHUNK = 500
  for (const [dbStationId, nodeIds] of stationNodeGroups.entries()) {
    // Chia thành các sub-batches tránh query quá dài
    for (let i = 0; i < nodeIds.length; i += UPDATE_CHUNK) {
      const chunk = nodeIds.slice(i, i + UPDATE_CHUNK)
      const placeholders = chunk.map(id => `'${id}'`).join(',')
      await sequelize.query(
        `UPDATE grid_nodes SET weather_station_id = ${dbStationId} WHERE node_id IN (${placeholders});`
      )
      totalUpdated += chunk.length
    }
    process.stdout.write(`\r  Đã cập nhật: ${totalUpdated.toLocaleString('vi-VN')}/${N.toLocaleString('vi-VN')} nodes`)
  }
  console.log()

  // ── Tổng kết ──────────────────────────────────────────────────────────────
  const stationCheck = await WeatherStation.count()
  const nodeCheck    = await sequelize.query(
    'SELECT COUNT(*) as c FROM grid_nodes WHERE weather_station_id IS NOT NULL;',
    { type: QueryTypes.SELECT }
  )

  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(`✅ HOÀN THÀNH`)
  console.log(`   Đã tạo ${stationCheck} trạm ảo hợp lệ. Đã map thành công cho ${nodeCheck[0].c} nodes.`)
  console.log(`   Trạm rỗng đã lọc: ${orphanCount}`)
  console.log('──────────────────────────────────────────────────────────────\n')
  console.log('📋 Bước tiếp theo: Khởi động lại backend để WeatherCron chạy với trạm mới.')
}

main()
  .catch(err => { console.error('❌ Lỗi:', err); process.exit(1) })
  .finally(() => sequelize.close())
