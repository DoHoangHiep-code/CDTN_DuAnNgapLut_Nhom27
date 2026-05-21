/**
 * test_first_batch.js — Kiểm tra pipeline Sạt lở: 10 nodes đầu tiên
 * ─────────────────────────────────────────────────────────────────
 * Cách chạy:
 *   cd backend
 *   node test_first_batch.js
 *
 * Script này:
 *   1. Load ONNX model từ src/modules/landslide/models/
 *   2. Query 10 nodes đầu từ landslide_grid_nodes
 *   3. Fetch Open-Meteo weather cho mỗi node
 *   4. Chạy predictLandslide() in-process
 *   5. Bulk UPSERT kết quả vào landslide_predictions
 *   6. In báo cáo chi tiết
 */

require('dotenv').config()

// Patch __dirname cho require trong landslideInference.js
// (landslideInference dùng __dirname để build đường dẫn model)
const { initLandslideModel } = require('./src/modules/landslide/services/landslideInference')
const { runFirstBatchTest }  = require('./src/modules/landslide/cron/landslideCron')

async function main() {
  console.log('='.repeat(60))
  console.log(' LANDSLIDE PIPELINE — TEST 10 NODES')
  console.log('='.repeat(60))

  // Step 1: Load ONNX model
  console.log('\n[1] Loading ONNX model...')
  try {
    await initLandslideModel()
    console.log('[1] ✅ Model loaded')
  } catch (err) {
    console.error('[1] ❌ Model load failed:', err.message)
    console.error('    → Đảm bảo file landslide_model.onnx và landslide_metadata.json')
    console.error('      nằm trong: backend/src/modules/landslide/models/')
    process.exit(1)
  }

  // Step 2–5: Chạy test batch (xem log từ runFirstBatchTest)
  console.log('\n[2] Running first batch test (10 nodes)...')
  await runFirstBatchTest()

  console.log('[DONE] Kiểm tra kết quả trong bảng landslide_predictions.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
