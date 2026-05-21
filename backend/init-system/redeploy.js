'use strict'

/**
 * init-system/redeploy.js – Master Recovery Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Khi DB bị sập / đổi link CockroachDB mới, chạy file này để khôi phục toàn bộ:
 *
 *   node init-system/redeploy.js
 *   hoặc: npm run setup:db
 *
 * Thứ tự thực thi:
 *   Step 1  – Tạo schema (CREATE TABLE, INDEX, MV)
 *   Step 2  – Import 53.291 grid nodes từ CSV
 *   Step 3  – Seed users (1 admin + 4 users)
 *   Step 4  – Seed 39 hotspots ngập lụt Hà Nội   ← TRƯỚC khi tính IDW
 *   Step 5  – Setup lưới trạm ảo 3×3km (cho toàn bộ 53.330 nodes)
 *   Step 6  – Tính IDW weights (st1/st2/st3) cho toàn bộ 53.330 nodes
 *   Step 7  – Gán station cho các node còn NULL (safety net)
 *   Step 8  – Geocoding location_name (chạy ngầm ~60 phút)
 *   Step 9  – Seed 425K điểm lưới sạt lở từ JSONL
 *   Step 10 – Seed dữ liệu sạt lở động (CSV + Open-Meteo API)
 *
 * Yêu cầu:
 *   - File .env đã cập nhật DATABASE_URL mới
 *   - File CSV: init-system/02_static_data/Hanoi_Grid_Features_Final_v2.csv
 *   - File JSONL: init-system/02_static_data/landslide_grid_nodes.jsonl
 *   - Node.js >= 18
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const BACKEND_DIR = path.join(__dirname, '..')
const SCRIPTS_DIR = path.join(__dirname, '03_scripts')
const SCHEMA_SQL = path.join(__dirname, '01_schema.sql')
const LANDSLIDE_SCHEMA = path.join(__dirname, '04_landslide_schema.sql')
const CSV_PATH = path.join(__dirname, '02_static_data', 'Hanoi_Grid_Features_Final_v2.csv')
const DATABASE_URL = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL

const log = (msg) => console.log(`\n${'═'.repeat(60)}\n${msg}\n${'═'.repeat(60)}`)
const step = (n, title) => console.log(`\n[Step ${n}] ${title}`)

function runScript(scriptPath, cwd = BACKEND_DIR) {
  return new Promise((resolve, reject) => {
    console.log(`  → node ${path.relative(BACKEND_DIR, scriptPath)}`)
    const proc = spawn('node', [scriptPath], {
      cwd,
      stdio: 'inherit',
      env: process.env,
    })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`Script exited with code ${code}: ${scriptPath}`))
    })
    proc.on('error', reject)
  })
}

async function main() {
  log('AQUAALERT – Disaster Recovery / Fresh Deploy')
  console.log(`DATABASE_URL: ${DATABASE_URL ? DATABASE_URL.replace(/:([^:@]+)@/, ':***@') : '(không có)'}`)

  if (!DATABASE_URL) {
    console.error('❌ Thiếu DATABASE_URL trong .env. Hãy cập nhật trước khi chạy redeploy.')
    process.exit(1)
  }

  // ── Step 1: Schema SQL ──────────────────────────────────────────────────────
  step(1, 'Tạo schema (CREATE TABLE, INDEX, Materialized Views)')
  const { sequelize } = require(path.join(BACKEND_DIR, 'src/db/sequelize'))
  try {
    await sequelize.authenticate()
    console.log('  ✅ Kết nối DB thành công.')

    // 01_schema.sql
    console.log('  Chạy: 01_schema.sql')
    const sql = fs.readFileSync(SCHEMA_SQL, 'utf-8')
    const statements = sql.replace(/--.*$/gm, '').split(/;\s*\n/).map(s => s.trim()).filter(s => s && s.length > 5)
    let ok = 0
    for (const stmt of statements) {
      try {
        await sequelize.query(stmt + ';')
        ok++
      } catch (e) {
        if (e.message.includes('already exists') || e.message.includes('duplicate')) {
          console.log(`  ⚠️  (bỏ qua đã tồn tại): ${stmt.slice(0, 60)}...`)
        } else {
          console.warn(`  ⚠️  Lỗi nhỏ: ${e.message.slice(0, 100)}`)
        }
      }
    }
    console.log(`  ✅ Schema 01_schema: ${ok} statements thực thi.`)

    // 04_landslide_schema.sql
    console.log('  Chạy: 04_landslide_schema.sql')
    if (fs.existsSync(LANDSLIDE_SCHEMA)) {
      const lsSql = fs.readFileSync(LANDSLIDE_SCHEMA, 'utf-8').replace(/--.*$/gm, '')
      const lsStmts = lsSql.split(/;\s*\n/).map(s => s.trim()).filter(s => s && s.length > 5)
      let lsOk = 0
      for (const stmt of lsStmts) {
        try {
          await sequelize.query(stmt + ';')
          lsOk++
        } catch (e) {
          if (e.message.includes('already exists') || e.message.includes('duplicate')) {
            console.log(`  ⚠️  (bỏ qua đã tồn tại): ${stmt.slice(0, 60)}...`)
          } else {
            console.warn(`  ⚠️  Lỗi nhỏ: ${e.message.slice(0, 100)}`)
          }
        }
      }
      console.log(`  ✅ Schema Landslide: ${lsOk} statements thực thi.`)
    }
  } catch (err) {
    console.error('❌ Không kết nối được DB:', err.message)
    process.exit(1)
  } finally {
    await sequelize.close()
  }

  // ── Step 2: Import 53K grid nodes từ CSV ────────────────────────────────────
  step(2, 'Import 53.291 grid nodes từ CSV')
  if (!fs.existsSync(CSV_PATH)) {
    console.warn(`  ⚠️  File CSV không tìm thấy: ${CSV_PATH}`)
    console.warn('  Bỏ qua step 2. Hãy copy CSV vào 02_static_data/ rồi chạy lại thủ công.')
  } else {
    await runScript(path.join(SCRIPTS_DIR, 'import_grid_features.js'))
    console.log('  ✅ Import CSV xong.')
  }

  // ── Step 3: Seed users ───────────────────────────────────────────────────────
  step(3, 'Seed tài khoản: 1 admin + 4 users (admin, analyst1-3, hiep)')
  await runScript(path.join(SCRIPTS_DIR, 'seed_users.js'))

  // ── Step 4: Seed hotspots ────────────────────────────────────────────────────
  // ⚠️  QUAN TRỌNG: Chạy TRƯỚC step 5 & 6 để 39 hotspot nodes được
  //     bao gồm trong mapping trạm và tính toán IDW trọng số.
  step(4, 'Seed 39 điểm ngập lụt thực tế Hà Nội  [TRƯỚC IDW]')
  await runScript(path.join(SCRIPTS_DIR, 'seed_hotspots.js'))

  // ── Step 5: Setup lưới trạm ảo ──────────────────────────────────────────────
  step(5, 'Setup lưới trạm ảo 3×3km + mapping nodes (toàn bộ 53.330 nodes)')
  await runScript(path.join(SCRIPTS_DIR, 'setup_virtual_stations.js'))

  // ── Step 6: IDW weights ──────────────────────────────────────────────────────
  step(6, 'Tính IDW weights (st1/st2/st3) cho toàn bộ 53.330 nodes')
  await runScript(path.join(SCRIPTS_DIR, 'calc_idw_weights.js'))

  // ── Step 7: Assign stations – safety net ────────────────────────────────────
  step(7, 'Gán weather_station_id cho các node còn NULL (safety net)')
  await runScript(path.join(SCRIPTS_DIR, 'assign_stations_to_nodes.js'))

  // ── Step 8: Geocoding (chạy ngầm, không block) ──────────────────────────────
  step(8, 'Geocoding location_name (chạy ngầm ~60 phút)')
  const geocoder = spawn('node', [path.join(SCRIPTS_DIR, 'geocode_location_names.js')], {
    cwd: BACKEND_DIR,
    stdio: 'ignore',
    detached: true,
    env: process.env,
  })
  geocoder.unref()
  console.log(`  ✅ Geocoding chạy ngầm (PID: ${geocoder.pid}).`)

  // ── Step 9: Seed Landslide Grid Nodes ───────────────────────────────────────
  step(9, 'Seed 425K điểm lưới sạt lở từ JSONL (landslide_grid_nodes)')
  const landslideJsonl = path.join(__dirname, '02_static_data', 'landslide_grid_nodes.jsonl')
  if (!fs.existsSync(landslideJsonl)) {
    console.warn(`  ⚠️  Không tìm thấy: ${landslideJsonl}`)
    console.warn('  Bỏ qua step 9. Chạy export_old_db.js để tạo file nguồn.')
  } else {
    await runScript(path.join(SCRIPTS_DIR, 'seed_landslide_nodes.js'))
    console.log('  ✅ Seed landslide_grid_nodes xong.')
  }

  // ── Step 10: Seed Landslide Pipeline (Open-Meteo) ───────────────────────────
  step(10, 'Khởi tạo dữ liệu sạt lở động (CSV + Open-Meteo API)')
  const landslideCSV = path.join(__dirname, '02_static_data', 'grid_prediction_datv2.csv')
  if (!fs.existsSync(landslideCSV)) {
    console.warn(`  ⚠️  Không tìm thấy: ${landslideCSV}`)
    console.warn('  Bỏ qua step 10. Đặt grid_prediction_datv2.csv vào 02_static_data/')
  } else {
    console.log('  (Quá trình này mất thời gian do fetch API Open-Meteo)')
    await runScript(path.join(SCRIPTS_DIR, 'seed_landslide_pipeline.js'))
  }

  log('✅ REDEPLOY HOÀN TẤT!')
  console.log('\nBước tiếp theo:')
  console.log('  1. Khởi động backend  : npm start')
  console.log('  2. Trigger cron       : curl -X POST http://localhost:3002/api/v1/weather/trigger-cron')
  console.log('  3. Geocoding sẽ tự hoàn thành trong ~60 phút (chạy ngầm)')
  console.log('')
}

main().catch(err => {
  console.error('\n❌ Redeploy thất bại:', err.message)
  process.exit(1)
})
