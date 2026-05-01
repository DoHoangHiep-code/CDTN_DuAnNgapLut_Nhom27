'use strict'

/**
 * import_grid_features.js  (v2 – Throttled Edition)
 * ─────────────────────────────────────────────────────────────────────────────
 * Nạp 53.291 điểm lưới từ CSV vào bảng grid_nodes trên Aiven.
 * Phiên bản này áp dụng "Throttling Strategy" để tránh Timeout:
 *   • BATCH_SIZE   = 200 rows/lần  (an toàn với Aiven connection pooler)
 *   • DELAY_MS     = 600 ms nghỉ giữa mỗi batch
 *   • MAX_RETRIES  = 3 lần thử lại mỗi batch nếu bị timeout/lỗi
 *   • Retry delay  = 2s (lần 1) → 4s (lần 2) → 8s (lần 3) — exponential backoff
 *
 * Chạy:  cd backend && node scripts/import_grid_features.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config()
const fs    = require('fs')
const path  = require('path')
const csv   = require('csv-parser')

const { sequelize } = require('../src/db/sequelize')
require('../src/models/index')
const { GridNode } = require('../src/models')

// ─── Cấu hình Throttling ─────────────────────────────────────────────────────

const BATCH_SIZE   = 1000   // Số rows mỗi lần bulkCreate (Aiven có thể chịu tải tốt hơn)
const DELAY_MS     = 100    // Nghỉ giữa các batch (ms)
const MAX_RETRIES  = 3      // Số lần thử lại khi batch lỗi
const RETRY_BASE_MS = 1000  // Base delay cho exponential backoff (ms)

const CSV_PATH = path.join(__dirname, '..', 'data', 'Hanoi_Grid_Features_Final_v2.csv')

// ─── Helper: sleep ────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Helper: format số với dấu phẩy ─────────────────────────────────────────

const fmt = (n) => n.toLocaleString('vi-VN')

// ─── Bảng hotspot: tọa độ khớp → tên phố thực ───────────────────────────────

const HOTSPOT_RADIUS = 0.0005   // ±0.0005° ≈ ±55m
const KNOWN_HOTSPOTS = [
  { lat: 21.0253, lon: 105.8435, name: 'Ngã tư Phan Bội Châu - Lý Thường Kiệt' },
  { lat: 21.0118, lon: 105.8201, name: 'Ngã tư Tây Sơn - Thái Hà' },
  { lat: 21.0310, lon: 105.7992, name: 'Phố Hoa Bằng' },
  { lat: 21.0298, lon: 105.8385, name: 'Nguyễn Khuyến - Lý Thường Kiệt' },
  { lat: 21.0428, lon: 105.8285, name: 'Thụy Khuê - Dốc La Pho' },
  { lat: 20.9997, lon: 105.8675, name: 'Minh Khai - Chân cầu Vĩnh Tuy' },
  { lat: 20.9952, lon: 105.8115, name: 'Nguyễn Trãi - Trước ĐH KHXH&NV' },
  { lat: 21.0025, lon: 105.7465, name: 'Đại lộ Thăng Long - Lê Trọng Tấn' },
  { lat: 21.0445, lon: 105.8755, name: 'Ngọc Lâm - Long Biên' },
  { lat: 21.0555, lon: 105.7825, name: 'Phạm Văn Đồng - Xuân Đỉnh' },
  { lat: 20.9845, lon: 105.8423, name: 'Giải Phóng - Bến xe Giáp Bát' },
  { lat: 20.9912, lon: 105.7952, name: 'Phùng Khoang' },
  { lat: 21.1416, lon: 105.8973, name: 'Xã Thư Lâm' },
]

function lookupHotspotName(lat, lon) {
  for (const h of KNOWN_HOTSPOTS) {
    if (Math.abs(h.lat - lat) <= HOTSPOT_RADIUS && Math.abs(h.lon - lon) <= HOTSPOT_RADIUS) {
      return h.name
    }
  }
  return null
}

// ─── Helper: upsert 1 batch với retry + exponential backoff ──────────────────

const UPSERT_FIELDS = [
  'grid_id', 'location_name',
  'dist_to_park_km', 'dist_to_drain_km', 'dist_to_river_km',
  'dist_to_main_road_km', 'dist_to_pump_km',
  'elevation', 'slope', 'impervious_ratio',
  'geom',
]

/**
 * @param {Array}  batch       - mảng records cần upsert
 * @param {number} batchIndex  - chỉ số batch (1-based)
 * @param {number} totalBatches
 * @returns {Promise<number>}  số rows thành công, hoặc 0 nếu hết retry
 */
async function upsertBatchWithRetry(batch, batchIndex, totalBatches) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await GridNode.bulkCreate(batch, {
        updateOnDuplicate: UPSERT_FIELDS,
        validate: false,
      })

      // ── Thành công ──
      const pct = ((batchIndex / totalBatches) * 100).toFixed(1)
      console.log(
        `[Batch ${batchIndex}/${totalBatches}] ✅ Đã đẩy xong ${batch.length} bản ghi.` +
        ` Tiến độ: ${pct}%. Nghỉ ${DELAY_MS}ms...`
      )
      return batch.length

    } catch (err) {
      const retryDelay = RETRY_BASE_MS * Math.pow(2, attempt - 1)  // 2s, 4s, 8s
      console.warn(
        `[Batch ${batchIndex}/${totalBatches}] ⚠️  Lần ${attempt}/${MAX_RETRIES} lỗi:` +
        ` ${err.message}. Thử lại sau ${retryDelay / 1000}s...`
      )
      if (attempt < MAX_RETRIES) {
        await delay(retryDelay)
      } else {
        console.error(
          `[Batch ${batchIndex}/${totalBatches}] ❌ Đã thử ${MAX_RETRIES} lần, bỏ qua batch này.`
        )
      }
    }
  }
  return 0
}

// ─── Hàm chính ───────────────────────────────────────────────────────────────

async function importGridFeatures() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT – Import 53K Grid Nodes (Throttled v2)           ║')
  console.log(`║   Batch=${BATCH_SIZE} rows | Delay=${DELAY_MS}ms | Retry=×${MAX_RETRIES}               ║`)
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  // 1. Kiểm tra file CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[ERROR] Không tìm thấy file CSV: ${CSV_PATH}`)
    process.exit(1)
  }

  // 2. Kết nối DB
  try {
    await sequelize.authenticate()
    console.log('[DB] ✅ Kết nối Aiven thành công.')
  } catch (err) {
    console.error('[DB] ❌ Kết nối thất bại:', err.message)
    process.exit(1)
  }

  // 3. Sync schema (alter:true — thêm cột mới nếu server.js chưa restart)
  try {
    await sequelize.sync({ alter: true })
    console.log('[DB] ✅ Schema sync OK.\n')
  } catch (err) {
    console.warn('[DB] ⚠️  sync(alter) warning (tiếp tục):', err.message)
  }

  // 4. Parse toàn bộ CSV vào RAM (~10 MB, an toàn)
  console.log(`[CSV] Đang đọc: ${CSV_PATH}`)
  const allRows = []
  let parseSkipped = 0

  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on('data', (row) => {
        const lat = parseFloat(row.latitude)
        const lon = parseFloat(row.longitude)
        if (isNaN(lat) || isNaN(lon)) { parseSkipped++; return }

        const gridNum = parseInt((row.grid_id || '').replace('Grid_', ''), 10)
        const node_id = isNaN(gridNum) ? null : gridNum + 1
        if (!node_id) { parseSkipped++; return }

        const hotspot      = lookupHotspotName(lat, lon)
        const location_name = hotspot ?? `Grid_${lat.toFixed(6)}_${lon.toFixed(6)}`

        allRows.push({
          node_id,
          latitude:             lat,
          longitude:            lon,
          grid_id:              row.grid_id || null,
          location_name,
          dist_to_park_km:      parseFloat(row.dist_to_park_km)      || null,
          dist_to_drain_km:     parseFloat(row.dist_to_drain_km)     || null,
          dist_to_river_km:     parseFloat(row.dist_to_river_km)     || null,
          dist_to_main_road_km: parseFloat(row.dist_to_main_road_km) || null,
          dist_to_pump_km:      parseFloat(row.dist_to_pump_km)      || null,
          elevation:            parseFloat(row.elevation)             || null,
          slope:                parseFloat(row.slope)                 || null,
          impervious_ratio:     parseFloat(row.impervious_ratio)      || null,
          geom:                 { type: 'Point', coordinates: [lon, lat] },
        })
      })
      .on('error', reject)
      .on('end',   resolve)
  })

  const totalBatches = Math.ceil(allRows.length / BATCH_SIZE)
  console.log(`[CSV] ✅ Parse xong: ${fmt(allRows.length)} hợp lệ, ${parseSkipped} bỏ qua.`)
  console.log(`[Plan] ${totalBatches} batches × ${BATCH_SIZE} rows | tổng ước tính ≈${Math.ceil(totalBatches * (DELAY_MS / 1000 + 0.3))}s\n`)

  if (!allRows.length) {
    console.error('[ERROR] Không có dòng hợp lệ. Thoát.')
    process.exit(1)
  }

  // 5. Upsert theo batch với throttling
  const startTime    = Date.now()
  let totalUpserted  = 0
  let totalFailed    = 0
  let batchIndex     = 0

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    batchIndex++
    const batch = allRows.slice(i, i + BATCH_SIZE)

    const upserted = await upsertBatchWithRetry(batch, batchIndex, totalBatches)
    totalUpserted += upserted
    if (upserted === 0) totalFailed += batch.length

    // Delay giữa các batch (ngay cả khi batch lỗi — để DB "thở")
    if (i + BATCH_SIZE < allRows.length) {
      await delay(DELAY_MS)
    }
  }

  // 6. Tổng kết
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const status  = totalFailed === 0 ? '✅  THÀNH CÔNG HOÀN TOÀN' : '⚠️   HOÀN THÀNH CÓ LỖI'

  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(`${status}`)
  console.log(`    Tổng rows CSV    : ${fmt(allRows.length)}`)
  console.log(`    Đã upsert OK     : ${fmt(totalUpserted)}`)
  console.log(`    Lỗi (bỏ qua)    : ${fmt(totalFailed)}`)
  console.log(`    Thời gian        : ${elapsed}s`)
  console.log(`    Cấu hình         : batch=${BATCH_SIZE}, delay=${DELAY_MS}ms, retry=×${MAX_RETRIES}`)
  console.log('──────────────────────────────────────────────────────────────\n')
  console.log('📋  Kiểm tra trên Aiven SQL Editor:')
  console.log('    SELECT COUNT(*) FROM grid_nodes;')
  console.log('    SELECT node_id, grid_id, location_name, elevation')
  console.log('    FROM grid_nodes ORDER BY node_id ASC LIMIT 10;')

  await sequelize.close()
  process.exit(totalFailed > 0 ? 1 : 0)
}

importGridFeatures().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
