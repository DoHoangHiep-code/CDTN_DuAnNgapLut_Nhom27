'use strict'

/**
 * import_grid_nodes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Import file CSV chứa 53.000 điểm lưới 100m vào bảng grid_nodes.
 *
 * Kỹ thuật:
 *  - Stream từng dòng bằng csv-parser (không load toàn bộ vào RAM)
 *  - Gom thành chunks 5.000 dòng → bulkCreate (upsert theo lat/lon)
 *  - Xây geometry POINT bằng raw SQL sau khi insert (PostGIS)
 *
 * Cột CSV → Model mapping:
 *  latitude, longitude, grid_id,
 *  dist_to_park_km, dist_to_drain_km, dist_to_river_km,
 *  dist_to_main_road_km, dist_to_pump_km,
 *  elevation → elevation (model field)
 *  slope, impervious_ratio
 *
 * Chạy:
 *  node scripts/import_grid_nodes.js
 *  node scripts/import_grid_nodes.js --file=data/custom_file.csv
 */

require('dotenv').config()

const fs      = require('fs')
const path    = require('path')
const csv     = require('csv-parser')
const { sequelize } = require('../src/db/sequelize')
const { GridNode }  = require('../src/models')

// ─── Config ──────────────────────────────────────────────────────────────────
const DEFAULT_CSV = path.resolve(__dirname, '../data/Hanoi_Grid_Features_Final_v2.csv')
const CHUNK_SIZE  = 5000   // rows per bulkCreate batch
const UPDATE_COLS = [      // columns to overwrite on conflict (lat/lon unique)
  'grid_id',
  'dist_to_park_km', 'dist_to_drain_km', 'dist_to_river_km',
  'dist_to_main_road_km', 'dist_to_pump_km',
  'elevation', 'slope', 'impervious_ratio',
]

// ─── Resolve CSV path (optional --file arg) ───────────────────────────────────
function resolveCsvPath() {
  const fileArg = process.argv.find(a => a.startsWith('--file='))
  if (fileArg) {
    const p = path.resolve(process.cwd(), fileArg.split('=')[1])
    if (!fs.existsSync(p)) {
      console.error(`[Import] ❌ File không tồn tại: ${p}`)
      process.exit(1)
    }
    return p
  }
  if (!fs.existsSync(DEFAULT_CSV)) {
    console.error(`[Import] ❌ Không tìm thấy file mặc định:\n  ${DEFAULT_CSV}`)
    console.error('[Import] Hãy đặt file CSV vào: backend/data/Hanoi_Grid_Features_Final_v2.csv')
    console.error('[Import] Hoặc truyền tham số: node scripts/import_grid_nodes.js --file=<path>')
    process.exit(1)
  }
  return DEFAULT_CSV
}

// ─── Validate & parse float an toàn ──────────────────────────────────────────
function safeFloat(val, fallback = null) {
  const n = parseFloat(val)
  return Number.isFinite(n) ? n : fallback
}

// ─── Build geometry bằng raw SQL sau khi insert ───────────────────────────────
async function updateGeometries(nodeIds) {
  // CockroachDB hỗ trợ ST_MakePoint + ST_SetSRID
  await sequelize.query(`
    UPDATE grid_nodes
    SET geom = ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326)
    WHERE (geom IS NULL OR geom = 'POINT EMPTY')
      AND node_id = ANY(:ids)
  `, { replacements: { ids: nodeIds.map(Number) } })
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = resolveCsvPath()
  const stats   = fs.statSync(csvPath)
  console.log(`\n[Import] 📂 File CSV: ${path.basename(csvPath)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
  console.log(`[Import] Chunk size : ${CHUNK_SIZE.toLocaleString('vi-VN')} rows/batch`)
  console.log('[Import] Bắt đầu stream...\n')

  const startTime   = Date.now()
  let chunk         = []
  let totalInserted = 0
  let totalSkipped  = 0
  let chunkNum      = 0
  let globalRowIdx  = 0   // global counter → dùng làm node_id

  // Lấy max node_id hiện tại để tránh conflict với hotspot 39 dòng đang có
  const [[{ maxId }]] = await sequelize.query('SELECT COALESCE(MAX(node_id), 0) AS "maxId" FROM grid_nodes')
  let nextId = Number(maxId) + 1
  console.log(`[Import] Max node_id hiện tại: ${maxId} → node_id mới bắt đầu từ ${nextId}\n`)

  // Hàm flush 1 chunk
  async function flushChunk(rows, startId) {
    chunkNum++
    const records = rows.map((r, i) => ({
      node_id:   startId + i,   // Gán ID tuần tự
      // lat/lon – bắt buộc
      latitude:  safeFloat(r.latitude),
      longitude: safeFloat(r.longitude),
      // grid_id
      grid_id:   r.grid_id ?? `Grid_${totalInserted + i}`,
      // Đặc trưng địa lý
      elevation:        safeFloat(r.elevation),       // tên CSV: elevation
      slope:            safeFloat(r.slope),
      impervious_ratio: safeFloat(r.impervious_ratio),
      // Khoảng cách đến hạ tầng
      dist_to_drain_km:     safeFloat(r.dist_to_drain_km),
      dist_to_river_km:     safeFloat(r.dist_to_river_km),
      dist_to_pump_km:      safeFloat(r.dist_to_pump_km),
      dist_to_main_road_km: safeFloat(r.dist_to_main_road_km),
      dist_to_park_km:      safeFloat(r.dist_to_park_km),
      // IDW fields – sẽ được điền bởi calculate_idw_weights.js
      is_out_of_bounds: false,
      // Geometry – sẽ build sau
      geom: { type: 'Point', coordinates: [safeFloat(r.longitude), safeFloat(r.latitude)] },
    })).filter(r => r.latitude != null && r.longitude != null)  // bỏ dòng thiếu lat/lon

    const skipped = rows.length - records.length
    totalSkipped += skipped

    try {
      const result = await GridNode.bulkCreate(records, {
        updateOnDuplicate: UPDATE_COLS,
        // Conflict theo unique index uq_grid_lat_lon
        conflictAttributes: ['latitude', 'longitude'],
        returning: ['node_id'],
      })

      const inserted = result.length
      totalInserted += inserted

      process.stdout.write(
        `\r[Import] Chunk #${chunkNum} → ` +
        `${totalInserted.toLocaleString('vi-VN')} nodes` +
        (totalSkipped > 0 ? ` (bỏ ${totalSkipped} dòng lỗi)` : '')
      )
    } catch (err) {
      console.error(`\n[Import] ⚠️  Chunk #${chunkNum} lỗi: ${err.message}`)
      // Tiếp tục với chunk tiếp, không dừng toàn bộ import
    }
  }

  // ─── Stream CSV với pause/resume backpressure ─────────────────────────────
  // Không dùng await bên trong .on('data') vì callback là synchronous.
  // Thay vào đó: pause() stream, await flushChunk(), resume() stream.
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath, { encoding: 'utf8' })
      .pipe(csv({
        mapHeaders: ({ header }) => header.trim(),
        mapValues:  ({ value  }) => value?.trim(),
      }))

    stream.on('data', (row) => {
      chunk.push(row)
      if (chunk.length >= CHUNK_SIZE) {
        const toFlush    = chunk.splice(0, CHUNK_SIZE)
        const chunkStart = nextId
        nextId          += toFlush.length

        // Pause stream → flush → resume (đúng backpressure pattern)
        stream.pause()
        flushChunk(toFlush, chunkStart)
          .then(() => stream.resume())
          .catch(err => {
            console.error('\n[Import] ❌ Flush lỗi nghiêm trọng:', err.message)
            reject(err)
          })
      }
    })

    stream.on('end', resolve)
    stream.on('error', reject)
  })

  // Flush chunk cuối (phần dư < CHUNK_SIZE)
  if (chunk.length > 0) {
    await flushChunk(chunk, nextId)
    nextId += chunk.length
    chunk = []
  }

  console.log()
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n[Import] ✅ Hoàn thành trong ${elapsed}s`)
  console.log(`  Đã insert/update : ${totalInserted.toLocaleString('vi-VN')} nodes`)
  console.log(`  Bỏ qua (lỗi)    : ${totalSkipped.toLocaleString('vi-VN')} dòng`)
  console.log('\n[Import] Bước tiếp theo:')
  console.log('  node scripts/generate_virtual_stations.js')
  console.log('  node scripts/calculate_idw_weights.js')
}

main()
  .catch(err => {
    console.error('\n[Import] ❌ Lỗi nghiêm trọng:', err.message)
    process.exit(1)
  })
  .finally(() => sequelize.close())

