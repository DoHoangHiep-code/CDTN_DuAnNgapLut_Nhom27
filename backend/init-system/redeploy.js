'use strict'

/**
 * init-system/redeploy.js – Master Recovery Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Khi DB bị sập / đổi link CockroachDB mới, chạy file này để khôi phục toàn bộ:
 *
 *   node init-system/redeploy.js
 *
 * Thứ tự thực thi:
 *   Step 1 – Tạo schema (CREATE TABLE, INDEX, MV)
 *   Step 2 – Import 53K grid nodes từ CSV
 *   Step 3 – Setup lưới trạm ảo 3×3km (88 trạm)
 *   Step 4 – Tính IDW weights (st1/st2/st3) cho 53K nodes
 *   Step 5 – Seed users (1 admin + 3 analyst)
 *   Step 6 – Seed 39 hotspots ngập lụt Hà Nội
 *   Step 7 – Geocoding location_name (chạy ngầm ~60 phút)
 *
 * Yêu cầu:
 *   - File .env đã cập nhật DATABASE_URL mới
 *   - File CSV đặt tại: init-system/02_static_data/Hanoi_Grid_Features_Final_v2.csv
 *   - Node.js >= 18
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const { execSync, spawn } = require('child_process')
const path  = require('path')
const fs    = require('fs')

const BACKEND_DIR  = path.join(__dirname, '..')
const SCRIPTS_DIR  = path.join(__dirname, '03_scripts')
const SCHEMA_SQL   = path.join(__dirname, '01_schema.sql')
const CSV_PATH     = path.join(__dirname, '02_static_data', 'Hanoi_Grid_Features_Final_v2.csv')
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
  console.log('  Chạy: 01_schema.sql')
  // Dùng sequelize để chạy từng statement (CockroachDB không hỗ trợ multi-statement qua psql tool thông thường)
  const { sequelize } = require(path.join(BACKEND_DIR, 'src/db/sequelize'))
  try {
    await sequelize.authenticate()
    console.log('  ✅ Kết nối DB thành công.')
    const sql = fs.readFileSync(SCHEMA_SQL, 'utf-8')
    // Tách các statement bởi dấu chấm phẩy, bỏ comment
    const statements = sql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && s.length > 5)
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
    console.log(`  ✅ Schema: ${ok} statements thực thi.`)
  } catch (err) {
    console.error('❌ Không kết nối được DB:', err.message)
    process.exit(1)
  } finally {
    await sequelize.close()
  }

  // ── Step 2: Import 53K grid nodes ──────────────────────────────────────────
  step(2, 'Import 53.330 grid nodes từ CSV')
  if (!fs.existsSync(CSV_PATH)) {
    console.warn(`  ⚠️  File CSV không tìm thấy: ${CSV_PATH}`)
    console.warn('  Bỏ qua step 2. Hãy copy CSV vào 02_static_data/ rồi chạy lại thủ công:')
    console.warn(`  node ${path.relative(BACKEND_DIR, path.join(SCRIPTS_DIR, 'import_grid_features.js'))}`)
  } else {
    await runScript(path.join(SCRIPTS_DIR, 'import_grid_features.js'))
    console.log('  ✅ Import CSV xong.')
  }

  // ── Step 3: Setup lưới trạm ảo ─────────────────────────────────────────────
  step(3, 'Setup lưới trạm ảo 3×3km (88 trạm) + mapping nodes')
  await runScript(path.join(SCRIPTS_DIR, 'setup_virtual_stations.js'))

  // ── Step 4: IDW weights ─────────────────────────────────────────────────────
  step(4, 'Tính IDW weights (st1/st2/st3) cho 53K nodes')
  await runScript(path.join(SCRIPTS_DIR, 'calc_idw_weights.js'))

  // ── Step 5: Seed users ──────────────────────────────────────────────────────
  step(5, 'Seed tài khoản: 1 admin + 3 analyst')
  await runScript(path.join(SCRIPTS_DIR, 'seed_users.js'))

  // ── Step 6: Seed hotspots ───────────────────────────────────────────────────
  step(6, 'Seed 39 điểm ngập lụt thực tế Hà Nội')
  await runScript(path.join(SCRIPTS_DIR, 'seed_hotspots.js'))

  // ── Step 7: Geocoding (ngầm) ────────────────────────────────────────────────
  step(7, 'Geocoding location_name (chạy ngầm ~60 phút)')
  console.log('  Bắt đầu geocoding ngầm...')
  const geocoder = spawn('node', [path.join(SCRIPTS_DIR, 'geocode_location_names.js')], {
    cwd: BACKEND_DIR,
    stdio: 'ignore',
    detached: true,
    env: process.env,
  })
  geocoder.unref()
  console.log(`  ✅ Geocoding chạy ngầm (PID: ${geocoder.pid}). Hoàn thành trong ~60 phút.`)

  log('✅ REDEPLOY HOÀN TẤT!')
  console.log('\nBước tiếp theo:')
  console.log('  1. Khởi động backend: npm start')
  console.log('  2. Trigger cron thủ công: curl -X POST http://localhost:3002/api/v1/weather/trigger-cron')
  console.log('  3. Sau ~60 phút geocoding xong, chạy: node fix_location_sync.js')
  console.log('')
}

main().catch(err => {
  console.error('\n❌ Redeploy thất bại:', err.message)
  process.exit(1)
})
