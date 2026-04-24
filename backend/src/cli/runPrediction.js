'use strict'

/**
 * Chạy batch prediction cho tất cả nodes và in kết quả.
 * Dùng: node src/cli/runPrediction.js
 */

require('dotenv').config()
const { sequelize } = require('../db/sequelize')
const { WeatherRepository } = require('../repositories/WeatherRepository')
const { PredictionService } = require('../services/PredictionService')

async function main() {
  const weatherRepository = new WeatherRepository({ sequelize })
  const predictionService = new PredictionService({ weatherRepository, sequelize })

  console.log('Đang chạy batch prediction...')
  const results = await predictionService.runBatchPrediction()

  if (!results.length) {
    console.log('Không có kết quả — kiểm tra AI service đang chạy và DB có dữ liệu.')
  } else {
    console.log(`\nKết quả (${results.length} nodes):`)
    for (const r of results) {
      console.log(`  Node ${r.nodeId}: ${r.flood_depth_cm} cm — ${r.risk_level}`)
    }
  }

  await sequelize.close()
}

main().catch((err) => {
  console.error('Lỗi:', err.message)
  process.exit(1)
})
