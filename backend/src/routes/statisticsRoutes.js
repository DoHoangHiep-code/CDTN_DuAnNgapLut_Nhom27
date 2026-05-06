'use strict'

const express = require('express')
const { sequelize } = require('../db/sequelize')

const router = express.Router()

/**
 * GET /api/v1/statistics/flooded-area
 * Mục đích: Thống kê tổng diện tích ngập dựa trên số lượng node ngập.
 * (Mỗi node ngập tương đương 1 hecta)
 * 
 * Query Params:
 *  - target_time (ISO string): Thời điểm cần lấy thống kê.
 */
router.get('/statistics/flooded-area', async (req, res) => {
  try {
    const targetTimeStr = req.query.target_time
    
    if (!targetTimeStr) {
      return res.status(400).json({
        success: false,
        error: { message: 'Vui lòng cung cấp target_time (ISO format).' }
      })
    }

    const targetTime = new Date(targetTimeStr)
    if (isNaN(targetTime.getTime())) {
      return res.status(400).json({
        success: false,
        error: { message: 'Định dạng target_time không hợp lệ.' }
      })
    }

    // Đếm số lượng node ngập (is_flooded = true) tại target_time
    const [result] = await sequelize.query(
      `SELECT COUNT(*) AS count_nodes 
       FROM flood_predictions 
       WHERE time = :targetTime AND is_flooded = true`,
      {
        replacements: { targetTime },
      }
    )

    const countNodes = result.length > 0 ? parseInt(result[0].count_nodes, 10) : 0
    
    // Tính toán: 1 node = 1 Hecta
    const totalFloodedAreaHa = countNodes * 1
    const totalFloodedAreaKm2 = totalFloodedAreaHa / 100

    return res.status(200).json({
      success: true,
      data: {
        timestamp: targetTime.toISOString(),
        total_flooded_nodes: countNodes,
        total_flooded_area_ha: totalFloodedAreaHa,
        total_flooded_area_km2: totalFloodedAreaKm2
      }
    })

  } catch (error) {
    console.error('[Statistics] Lỗi tính diện tích ngập:', error.message)
    return res.status(500).json({
      success: false,
      error: { message: 'Đã xảy ra lỗi khi tính toán diện tích ngập.' }
    })
  }
})

module.exports = { statisticsRouter: router }
