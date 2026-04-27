const express = require('express')
const { sequelize, FloodPrediction } = require('../models')

const router = express.Router()

// GET /api/v1/health-check
// Mục đích:
// 1) Kiểm tra kết nối DB thật sự hoạt động.
// 2) Kiểm tra dữ liệu dự báo gần nhất để đánh giá độ "tươi".
router.get('/health-check', async (_req, res) => {
  let db_connected = false
  let last_cron_run = null

  try {
    // Bước 1: xác thực kết nối DB.
    await sequelize.authenticate()
    db_connected = true

    // Bước 2: lấy bản ghi FloodPrediction mới nhất theo thời gian.
    const latest = await FloodPrediction.findOne({
      order: [['time', 'DESC']],
      attributes: ['time'],
    })

    last_cron_run = latest?.time ?? null

    // Bước 3: trả trạng thái ok khi DB kết nối thành công.
    return res.status(200).json({
      status: 'ok',
      db_connected,
      last_cron_run,
    })
  } catch (err) {
    // Trả lỗi mềm để monitoring dễ đọc, đồng thời không làm crash server.
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({
      status: 'error',
      db_connected,
      last_cron_run,
      error: { message },
    })
  }
})

module.exports = { healthCheckRouter: router }

