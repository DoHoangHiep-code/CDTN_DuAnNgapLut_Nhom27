'use strict'
require('dotenv').config()
const { runLandslideJob } = require('../src/modules/landslide/cron/landslideCron')

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT - Trigger Manual Landslide AI Prediction Job     ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  try {
    console.log('[Cron] ⏳ Đang khởi động tiến trình quét sạt lở bằng AI (ONNX)...')
    await runLandslideJob()
    console.log('\n[Cron] ✅ Toàn bộ quá trình quét và dự báo sạt lở đã hoàn tất!')
  } catch (err) {
    console.error('\n[Cron] ❌ Xảy ra lỗi:', err)
  } finally {
    process.exit(0)
  }
}

run()
