'use strict'
require('dotenv').config()
const { sequelize } = require('../src/db/sequelize')
const { manualTrigger } = require('../src/modules/flood/cron/weatherCron')

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT - Trigger Manual Flood & Weather Cron Job        ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  try {
    await sequelize.authenticate()
    console.log('[DB] ✅ Kết nối CockroachDB thành công.')
    
    console.log('[Cron] ⏳ Đang bắt đầu chạy tiến trình lấy dữ liệu thời tiết và dự báo ngập lụt (IDW + AI)...')
    await manualTrigger()
    
    console.log('\n[Cron] ✅ Toàn bộ quá trình dự báo đã hoàn tất!')
  } catch (err) {
    console.error('\n[Cron] ❌ Xảy ra lỗi:', err)
  } finally {
    await sequelize.close()
    process.exit(0)
  }
}

run()
