'use strict'

/**
 * scripts/calc_idw_weights.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tính 3 trạm gần nhất + trọng số IDW (Inverse Distance Weighting) cho mỗi node.
 *
 * Công thức:
 *   w_i(raw) = 1 / d_i²
 *   Weight_i = w_i / (w1 + w2 + w3)   → tổng = 1.0
 *
 * Kết quả lưu vào grid_nodes: st1_id, st1_weight, st2_id, st2_weight, st3_id, st3_weight
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config()

const { sequelize }     = require('../src/db/sequelize')
const { WeatherStation } = require('../src/models')
const { QueryTypes }    = require('sequelize')

const UPDATE_BATCH = 500  // rows per SQL batch
const MIN_DIST_KM  = 0.05 // Tránh chia cho 0 (node trùng với trạm)

// ─── Haversine (km) ───────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT – Tính trọng số IDW cho 53K nodes               ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  await sequelize.authenticate()
  console.log('[DB] ✅ Kết nối thành công.\n')

  // 1. Tải danh sách 88 trạm
  const stations = await WeatherStation.findAll({ raw: true })
  console.log(`[Stations] Tải ${stations.length} trạm thời tiết.`)
  const stationsF = stations.map(s => ({
    id:  Number(s.id),
    lat: parseFloat(s.latitude),
    lon: parseFloat(s.longitude),
  }))

  // 2. Tải toàn bộ nodes (chỉ cần node_id, lat, lon)
  console.log('[Nodes] Đang tải grid_nodes...')
  const nodes = await sequelize.query(
    'SELECT node_id, latitude, longitude FROM grid_nodes;',
    { type: QueryTypes.SELECT }
  )
  console.log(`[Nodes] Tải ${nodes.length.toLocaleString('vi-VN')} nodes.\n`)

  // 3. Tính IDW weights in-memory
  console.log('[IDW] Đang tính trọng số IDW...')
  const startCalc = Date.now()

  const updateData = nodes.map(n => {
    const lat = parseFloat(n.latitude)
    const lon = parseFloat(n.longitude)

    // Tính khoảng cách đến tất cả trạm, sắp xếp tăng dần
    const dists = stationsF.map(s => ({
      id:  s.id,
      km:  Math.max(haversineKm(lat, lon, s.lat, s.lon), MIN_DIST_KM),
    })).sort((a, b) => a.km - b.km)

    // Lấy 3 trạm gần nhất
    const top3 = dists.slice(0, 3)

    // Tính trọng số IDW: w_i = 1/d² rồi normalize
    const raws = top3.map(t => 1 / (t.km * t.km))
    const sumW = raws.reduce((s, w) => s + w, 0)
    const weights = raws.map(r => parseFloat((r / sumW).toFixed(6)))

    // Đảm bảo tổng = 1.0 (điều chỉnh phần dư vào weight đầu)
    const diff = parseFloat((1.0 - weights[0] - weights[1] - weights[2]).toFixed(6))
    weights[0] = parseFloat((weights[0] + diff).toFixed(6))

    return {
      node_id:    String(n.node_id),
      st1_id:     top3[0].id,
      st1_weight: weights[0],
      st2_id:     top3[1].id,
      st2_weight: weights[1],
      st3_id:     top3[2].id,
      st3_weight: weights[2],
    }
  })

  const calcMs = Date.now() - startCalc
  console.log(`[IDW] ✅ Tính xong ${updateData.length.toLocaleString('vi-VN')} nodes trong ${(calcMs/1000).toFixed(1)}s\n`)

  // 4. Batch UPDATE vào DB
  console.log(`[DB] Đang cập nhật DB (batch ${UPDATE_BATCH} rows/lần)...`)
  const startDb = Date.now()
  let total = 0

  for (let i = 0; i < updateData.length; i += UPDATE_BATCH) {
    const batch = updateData.slice(i, i + UPDATE_BATCH)

    // Build VALUES string cho 1 câu UPDATE ... FROM (VALUES ...)
    const values = batch.map(r =>
      `('${r.node_id}', ${r.st1_id}, ${r.st1_weight}, ${r.st2_id}, ${r.st2_weight}, ${r.st3_id}, ${r.st3_weight})`
    ).join(',\n')

    await sequelize.query(`
      UPDATE grid_nodes AS gn
      SET
        st1_id     = v.st1_id::bigint,
        st1_weight = v.st1_weight::float,
        st2_id     = v.st2_id::bigint,
        st2_weight = v.st2_weight::float,
        st3_id     = v.st3_id::bigint,
        st3_weight = v.st3_weight::float
      FROM (VALUES ${values}) AS v(node_id, st1_id, st1_weight, st2_id, st2_weight, st3_id, st3_weight)
      WHERE gn.node_id::text = v.node_id;
    `)

    total += batch.length
    process.stdout.write(`\r  Đã cập nhật: ${total.toLocaleString('vi-VN')}/${updateData.length.toLocaleString('vi-VN')}`)
  }

  const dbMs = Date.now() - startDb
  console.log(`\n[DB] ✅ Cập nhật xong ${total.toLocaleString('vi-VN')} nodes trong ${(dbMs/1000).toFixed(1)}s\n`)

  // 5. Kiểm tra kết quả
  const [check] = await sequelize.query(`
    SELECT
      COUNT(*) FILTER (WHERE st1_id IS NOT NULL) AS done,
      COUNT(*) FILTER (WHERE st1_id IS NULL) AS remaining
    FROM grid_nodes;
  `, { type: QueryTypes.SELECT })

  console.log('──────────────────────────────────────────────────────────────')
  console.log(`✅ HOÀN THÀNH IDW Weights`)
  console.log(`   Đã cập nhật: ${Number(check.done).toLocaleString('vi-VN')} nodes`)
  console.log(`   Còn NULL:    ${Number(check.remaining).toLocaleString('vi-VN')} nodes`)

  // Kiểm tra 1 sample
  const [sample] = await sequelize.query(`
    SELECT node_id, st1_id, st1_weight, st2_id, st2_weight, st3_id, st3_weight
    FROM grid_nodes WHERE st1_id IS NOT NULL LIMIT 3;
  `, { type: QueryTypes.SELECT })
  console.log('\n📋 Sample IDW:')
  sample.forEach(r => console.log(`   Node ${r.node_id}: st1=${r.st1_id}(${r.st1_weight}) st2=${r.st2_id}(${r.st2_weight}) st3=${r.st3_id}(${r.st3_weight})`))
  console.log('──────────────────────────────────────────────────────────────\n')
}

main()
  .catch(err => { console.error('❌ Lỗi:', err.message); process.exit(1) })
  .finally(() => sequelize.close())
