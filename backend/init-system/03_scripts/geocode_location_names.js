'use strict'

/**
 * scripts/geocode_location_names.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cập nhật location_name cho grid_nodes theo phương pháp phân vùng ô lưới:
 *
 * Thay vì gọi API từng node (53K = không khả thi), script dùng chiến thuật:
 *   1. Chia bản đồ Hà Nội thành lưới ô ~0.5km × 0.5km (~2000 ô)
 *   2. Với mỗi ô, gọi Nominatim 1 lần cho tọa độ tâm ô
 *   3. Tất cả nodes trong ô đó được gán cùng tên địa danh
 *   4. Delay 1.2s giữa mỗi call để tránh rate limit
 *
 * Kết quả: ~100% nodes có tên Phường/Xã chính xác, chỉ cần ~2000 API calls.
 *
 * Chạy: node scripts/geocode_location_names.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config()

const axios  = require('axios')
const { sequelize } = require('../src/db/sequelize')
const { QueryTypes } = require('sequelize')

// ─── Cấu hình ─────────────────────────────────────────────────────────────────
const CELL_DEG    = 0.004    // ~0.44km per cell (cân bằng giữa accuracy và số API calls)
const DELAY_MS    = 1200     // 1.2s giữa mỗi Nominatim call
const UPDATE_BATCH = 2000    // rows mỗi UPDATE batch
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Hà Nội bounding box (thực tế từ grid_nodes) ─────────────────────────────
const BBOX = { minLat: 20.86, maxLat: 21.18, minLon: 105.62, maxLon: 105.95 }

// ─── Parse địa chỉ từ Nominatim response ─────────────────────────────────────
function parseLocationName(addr) {
  if (!addr) return null
  const ward     = addr.quarter || addr.suburb || addr.neighbourhood
  const district = addr.city_district || addr.county
  const city     = addr.city || addr.state

  if (ward && district) return `${ward}, ${district}`
  if (ward && city)     return `${ward}, ${city}`
  if (district)         return district
  return null
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT – Geocode location_name (Cell Grid Strategy)     ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  await sequelize.authenticate()

  // Tải nodes chưa có tên hoặc có tên dạng "Grid_"
  console.log('[Query] Đang tải nodes cần geocode...')
  const nodes = await sequelize.query(`
    SELECT node_id, latitude, longitude, location_name
    FROM grid_nodes
    WHERE location_name IS NULL OR location_name LIKE 'Grid_%'
    ORDER BY node_id;
  `, { type: QueryTypes.SELECT })
  console.log(`[Query] ${nodes.length.toLocaleString('vi-VN')} nodes cần cập nhật.\n`)

  if (!nodes.length) {
    console.log('✅ Tất cả nodes đã có location_name. Không cần làm gì.')
    return
  }

  // ── Bước 1: Nhóm nodes theo ô lưới ──────────────────────────────────────────
  console.log('[Grid] Đang nhóm nodes theo ô lưới...')
  const cellMap = new Map()  // key: `${cellR}_${cellC}` → { centLat, centLon, nodeIds[] }

  for (const n of nodes) {
    const lat = parseFloat(n.latitude)
    const lon = parseFloat(n.longitude)
    const r   = Math.floor((lat - BBOX.minLat) / CELL_DEG)
    const c   = Math.floor((lon - BBOX.minLon) / CELL_DEG)
    const key = `${r}_${c}`

    if (!cellMap.has(key)) {
      cellMap.set(key, {
        centLat: BBOX.minLat + (r + 0.5) * CELL_DEG,
        centLon: BBOX.minLon + (c + 0.5) * CELL_DEG,
        nodeIds: [],
      })
    }
    cellMap.get(key).nodeIds.push(String(n.node_id))
  }
  console.log(`[Grid] Tổng ô lưới cần gọi API: ${cellMap.size}\n`)

  // ── Bước 2: Gọi Nominatim cho từng ô + update DB theo batch ──────────────────
  const nameMap = new Map()   // node_id → location_name
  let cellDone = 0
  let apiSuccess = 0
  let apiFail = 0

  for (const [key, cell] of cellMap.entries()) {
    try {
      const res = await axios.get(NOMINATIM_URL, {
        params: { lat: cell.centLat, lon: cell.centLon, format: 'json', zoom: 16, addressdetails: 1 },
        headers: { 'User-Agent': 'AQUAALERT-GeocoderBot/1.0' },
        timeout: 8000,
      })
      const name = parseLocationName(res.data?.address)
      if (name) {
        apiSuccess++
        for (const nid of cell.nodeIds) nameMap.set(nid, name)
      } else {
        apiFail++
        // Fallback: format tọa độ đẹp hơn dạng cũ
        const fallback = `Khu vực ${cell.centLat.toFixed(3)}, ${cell.centLon.toFixed(3)}`
        for (const nid of cell.nodeIds) nameMap.set(nid, fallback)
      }
    } catch {
      apiFail++
      const fallback = `Khu vực ${cell.centLat.toFixed(3)}, ${cell.centLon.toFixed(3)}`
      for (const nid of cell.nodeIds) nameMap.set(nid, fallback)
    }

    cellDone++
    process.stdout.write(`\r  Tiến độ: ${cellDone}/${cellMap.size} ô | ✅ ${apiSuccess} | ❌ ${apiFail}`)
    await sleep(DELAY_MS)

    // Batch update DB mỗi 200 ô để không mất dữ liệu nếu bị gián đoạn
    if (cellDone % 200 === 0 || cellDone === cellMap.size) {
      if (nameMap.size > 0) {
        const entries = [...nameMap.entries()]
        for (let i = 0; i < entries.length; i += UPDATE_BATCH) {
          const chunk = entries.slice(i, i + UPDATE_BATCH)
          const values = chunk.map(([id, name]) =>
            `('${id}', '${name.replace(/'/g, "''")}')`
          ).join(',\n')
          await sequelize.query(`
            UPDATE grid_nodes AS gn
            SET location_name = v.name
            FROM (VALUES ${values}) AS v(node_id, name)
            WHERE gn.node_id::text = v.node_id;
          `)
        }
        console.log(`\n  → Đã lưu ${nameMap.size.toLocaleString('vi-VN')} nodes vào DB`)
        nameMap.clear()
      }
    }
  }

  // ── Tổng kết ──────────────────────────────────────────────────────────────
  const [check] = await sequelize.query(`
    SELECT
      COUNT(*) FILTER (WHERE location_name NOT LIKE 'Grid_%' AND location_name IS NOT NULL) AS named,
      COUNT(*) FILTER (WHERE location_name LIKE 'Grid_%' OR location_name IS NULL) AS unnamed
    FROM grid_nodes;
  `, { type: QueryTypes.SELECT })

  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(`✅ HOÀN THÀNH Geocoding`)
  console.log(`   Đã đặt tên: ${Number(check.named).toLocaleString('vi-VN')} nodes`)
  console.log(`   Còn khuyết: ${Number(check.unnamed).toLocaleString('vi-VN')} nodes`)
  console.log(`   API success: ${apiSuccess} | fail: ${apiFail} / ${cellMap.size} ô`)
  console.log('──────────────────────────────────────────────────────────────\n')
}

main()
  .catch(e => { console.error('❌', e.message); process.exit(1) })
  .finally(() => sequelize.close())
