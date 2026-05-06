'use strict'

/**
 * calculate_idw_weights.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tính trọng số IDW (Inverse Distance Weighting) tĩnh cho từng grid_node.
 *
 * Công thức:
 *   w_i = (1 / d_i²)  ,  sau đó chuẩn hóa: w_i_norm = w_i / Σw_j
 *
 * Kết quả được lưu vào các cột st1_id, st1_weight, st2_id, st2_weight,
 * st3_id, st3_weight, is_out_of_bounds của bảng grid_nodes.
 *
 * Điều kiện:
 *   - Trạm gần nhất > 15km → is_out_of_bounds = true (fallback OWM Live)
 *   - Trạm gần nhất <= 15km → IDW bình thường
 *
 * Chạy SAU khi generate_virtual_stations.js đã hoàn thành:
 *   node scripts/calculate_idw_weights.js
 */

require('dotenv').config()
const { sequelize } = require('../src/db/sequelize')
const { GridNode, WeatherStation } = require('../src/models')

const OUT_OF_BOUNDS_KM = 15   // Ngưỡng "vùng mù"
const TOP_K = 3               // Lấy 3 trạm gần nhất

// ─── Haversine distance (km) ──────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Tìm K trạm gần nhất + tính trọng số IDW ─────────────────────────────────
function calcIDW(nodeLat, nodeLon, stations) {
  // Tính khoảng cách tới tất cả trạm
  const dists = stations.map(s => ({
    id:   s.id,
    dist: haversineKm(nodeLat, nodeLon, s.lat, s.lon),
  })).sort((a, b) => a.dist - b.dist)

  const nearest = dists[0]

  if (nearest.dist > OUT_OF_BOUNDS_KM) {
    return { isOutOfBounds: true, stations: [] }
  }

  // Lấy TOP_K trạm gần nhất, xử lý trường hợp trạm cách 0m (tránh ÷0)
  const top = dists.slice(0, TOP_K)
  const weights = top.map(t => ({
    id:     t.id,
    rawW:   t.dist < 0.001 ? 1e9 : 1 / (t.dist * t.dist),
  }))

  const sumW = weights.reduce((s, w) => s + w.rawW, 0)
  const normalized = weights.map(w => ({
    id:     w.id,
    weight: w.rawW / sumW,
  }))

  return { isOutOfBounds: false, stations: normalized }
}

async function main() {
  console.log('\n[IDW] Bắt đầu tính trọng số IDW tĩnh...')

  // 1. Load tất cả trạm ảo
  const stationRows = await WeatherStation.findAll({ raw: true })
  if (!stationRows.length) {
    console.error('[IDW] ❌ Chưa có trạm ảo. Chạy generate_virtual_stations.js trước.')
    process.exit(1)
  }
  const stations = stationRows.map(s => ({
    id:  s.id,
    lat: parseFloat(s.latitude),
    lon: parseFloat(s.longitude),
  }))
  console.log(`[IDW] Đọc được ${stations.length} trạm ảo.`)

  // 2. Load tất cả grid_nodes (chỉ lấy các trường cần thiết)
  const nodes = await GridNode.findAll({
    attributes: ['node_id', 'latitude', 'longitude'],
    raw: true,
  })
  console.log(`[IDW] Đọc được ${nodes.length.toLocaleString('vi-VN')} grid_nodes.`)

  if (!nodes.length) {
    console.error('[IDW] ❌ Không có node nào.')
    process.exit(1)
  }

  // 3. Tính IDW và batch update
  const BATCH = 200
  let processed = 0
  let outOfBounds = 0

  for (let i = 0; i < nodes.length; i += BATCH) {
    const chunk = nodes.slice(i, i + BATCH)
    const updates = chunk.map(n => {
      const lat = parseFloat(n.latitude)
      const lon = parseFloat(n.longitude)
      const { isOutOfBounds, stations: topStations } = calcIDW(lat, lon, stations)

      if (isOutOfBounds) {
        outOfBounds++
        return {
          node_id:          Number(n.node_id),
          is_out_of_bounds: true,
          st1_id: null, st1_weight: null,
          st2_id: null, st2_weight: null,
          st3_id: null, st3_weight: null,
        }
      }

      const [s1, s2, s3] = topStations
      return {
        node_id:          Number(n.node_id),
        is_out_of_bounds: false,
        st1_id:     s1?.id     ?? null,
        st1_weight: s1?.weight ?? null,
        st2_id:     s2?.id     ?? null,
        st2_weight: s2?.weight ?? null,
        st3_id:     s3?.id     ?? null,
        st3_weight: s3?.weight ?? null,
      }
    })

    // ── Bulk update bằng CASE/VALUES (PostgreSQL/CockroachDB style) ────────
    if (updates.length > 0) {
      // Xây dựng VALUES clause
      const valuesClause = updates.map((u, idx) => `(
        $${idx*8 + 1}::int,
        $${idx*8 + 2}::boolean,
        $${idx*8 + 3}::float, $${idx*8 + 4}::float,
        $${idx*8 + 5}::float, $${idx*8 + 6}::float,
        $${idx*8 + 7}::float, $${idx*8 + 8}::float
      )`).join(', ')

      const bindParams = updates.flatMap(u => [
        u.node_id,
        u.is_out_of_bounds,
        u.st1_id, u.st1_weight,
        u.st2_id, u.st2_weight,
        u.st3_id, u.st3_weight
      ])

      const sql = `
        UPDATE grid_nodes AS g
        SET
          is_out_of_bounds = v.is_out_of_bounds,
          st1_id = v.st1_id, st1_weight = v.st1_weight,
          st2_id = v.st2_id, st2_weight = v.st2_weight,
          st3_id = v.st3_id, st3_weight = v.st3_weight
        FROM (VALUES ${valuesClause}) AS v(
          node_id, is_out_of_bounds,
          st1_id, st1_weight,
          st2_id, st2_weight,
          st3_id, st3_weight
        )
        WHERE g.node_id = v.node_id
      `

      await sequelize.query(sql, { bind: bindParams })
    }

    processed += chunk.length
    process.stdout.write(`\r  Đã xử lý: ${processed.toLocaleString('vi-VN')}/${nodes.length.toLocaleString('vi-VN')} nodes`)
  }

  console.log()
  console.log(`\n[IDW] Đang cập nhật node_count cho các trạm ảo...`)
  const countSql = `
    UPDATE weather_stations AS ws
    SET node_count = count_data.c
    FROM (
      SELECT st1_id, COUNT(*) AS c
      FROM grid_nodes
      WHERE st1_id IS NOT NULL
      GROUP BY st1_id
    ) AS count_data
    WHERE ws.id = count_data.st1_id
  `
  await sequelize.query(countSql)

  console.log(`\n[IDW] ✅ Hoàn thành!`)
  console.log(`  Tổng nodes      : ${nodes.length.toLocaleString('vi-VN')}`)
  console.log(`  In-bounds (IDW) : ${(nodes.length - outOfBounds).toLocaleString('vi-VN')}`)
  console.log(`  Out-of-bounds   : ${outOfBounds.toLocaleString('vi-VN')} (fallback OWM Live)`)
}

main()
  .catch(err => {
    console.error('[IDW] ❌ Lỗi:', err.message)
    process.exit(1)
  })
  .finally(() => sequelize.close())
