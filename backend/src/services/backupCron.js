'use strict'

/**
 * backupCron.js – Data Retention & Monthly Backup
 * ─────────────────────────────────────────────────────────────────────────────
 * Schedule: "0 0 1 * *" → 00:00 ngày 1 mỗi tháng (ICT)
 *
 * Luồng xử lý:
 *   1. Query weather_measurements cũ hơn 30 ngày
 *   2. Export ra CSV: backups/weather_data_YYYY_MM.csv
 *   3. CHỈ khi export thành công → DELETE các dòng cũ đó
 *
 * Lý do thiết kế:
 *   - CockroachDB Serverless có giới hạn 10GB storage.
 *   - Xóa ngay mà không backup có thể mất data lịch sử quý giá cho AI training.
 *   - "Export first, delete second" đảm bảo không mất data trong mọi tình huống.
 */

require('dotenv').config()

const cron   = require('node-cron')
const fs     = require('fs')
const path   = require('path')
const { sequelize } = require('../db/sequelize')

const BACKUPS_DIR      = path.resolve(__dirname, '../../backups')
const RETENTION_DAYS   = 30

// ─── Helper: escape CSV field ─────────────────────────────────────────────────
function csvEscape(val) {
  if (val == null) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// ─── Hàm backup chính ────────────────────────────────────────────────────────
async function runBackup() {
  const now       = new Date()
  const yearMonth = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`
  const cutoff    = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000)

  console.log(`\n[BackupCron] ⏰ Bắt đầu backup lúc ${now.toISOString()}`)
  console.log(`[BackupCron] Ngưỡng thời gian: dữ liệu trước ${cutoff.toISOString()}`)

  // 1. Query data cũ
  let rows
  try {
    const [result] = await sequelize.query(
      `SELECT * FROM weather_measurements WHERE time < :cutoff ORDER BY time ASC`,
      { replacements: { cutoff } }
    )
    rows = result
    console.log(`[BackupCron] Tìm thấy ${rows.length.toLocaleString('vi-VN')} bản ghi cũ hơn ${RETENTION_DAYS} ngày.`)
  } catch (err) {
    console.error('[BackupCron] ❌ Không thể query data cũ:', err.message)
    return
  }

  if (!rows.length) {
    console.log('[BackupCron] ℹ️  Không có dữ liệu cũ cần backup. Kết thúc.')
    return
  }

  // 2. Export CSV
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true })
  }
  const csvPath = path.join(BACKUPS_DIR, `weather_data_${yearMonth}.csv`)

  try {
    const headers = Object.keys(rows[0])
    const lines   = [
      headers.join(','),
      ...rows.map(row => headers.map(h => csvEscape(row[h])).join(',')),
    ]
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8')
    const sizeMb = (fs.statSync(csvPath).size / 1024 / 1024).toFixed(2)
    console.log(`[BackupCron] ✅ Export thành công: ${csvPath} (${sizeMb} MB, ${rows.length.toLocaleString('vi-VN')} dòng)`)
  } catch (err) {
    console.error('[BackupCron] ❌ Export CSV thất bại — KHÔNG xóa data DB:', err.message)
    return   // Dừng lại: không xóa nếu export lỗi
  }

  // 3. Chỉ sau khi export thành công mới DELETE
  try {
    const [, meta] = await sequelize.query(
      `DELETE FROM weather_measurements WHERE time < :cutoff`,
      { replacements: { cutoff } }
    )
    const deleted = meta?.rowCount ?? rows.length
    console.log(`[BackupCron] ✅ Đã xóa ${deleted.toLocaleString('vi-VN')} dòng cũ khỏi CockroachDB.`)
  } catch (err) {
    console.error('[BackupCron] ⚠️ Export xong nhưng DELETE thất bại:', err.message)
    console.error('[BackupCron] File backup vẫn an toàn tại:', csvPath)
  }

  console.log('[BackupCron] 🏁 Backup tháng hoàn tất.\n')
}

// ─── Đăng ký Cronjob ─────────────────────────────────────────────────────────
function startBackupCron() {
  // Ngày 1 hàng tháng, 00:00 ICT
  cron.schedule('0 0 1 * *', () => {
    console.log('[BackupCron] Cron trigger tự động...')
    runBackup().catch(err => console.error('[BackupCron] Unhandled error:', err))
  }, {
    timezone: 'Asia/Ho_Chi_Minh',
  })

  console.log('[BackupCron] ✅ Đã đăng ký cron: 00:00 ngày 1 mỗi tháng (ICT).')
  console.log(`[BackupCron] Backup dir: ${BACKUPS_DIR}`)
}

module.exports = { startBackupCron, runBackup }
