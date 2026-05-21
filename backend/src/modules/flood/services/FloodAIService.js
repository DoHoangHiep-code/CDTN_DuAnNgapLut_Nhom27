'use strict'

/**
 * FloodAIService – gọi Python FastAPI microservice để dự đoán độ ngập lụt.
 *
 * ⚠️  CRITICAL TIMEOUT: axios được đặt timeout=3000ms.
 * Nếu AI service chết hoặc quá tải, Node.js server KHÔNG bị treo.
 * Fallback trả về null để caller quyết định xử lý tiếp.
 */

const axios = require('axios')

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000'
const AI_TIMEOUT_MS = 3000 // Cứng 3 giây – không nới lỏng

/**
 * Gọi AI service để dự đoán độ ngập lụt.
 *
 * @param {object} weatherData - Object thời tiết. Các key phải khớp với
 *   field trong WeatherData Pydantic model (xem ai_service/main.py).
 *
 *   Ví dụ tối thiểu:
 *   {
 *     station_id: 48900,
 *     year: 2024, month: 9, day: 15, hour: 14,
 *     temp: 31.5, rhum: 85.0, prcp: 45.2, wspd: 22.0, pres: 1008.5
 *   }
 *
 * @returns {Promise<number|null>}
 *   - number: độ ngập dự đoán (cm)
 *   - null:   AI service không phản hồi hoặc trả lỗi → dùng fallback
 */
async function getFloodPrediction(weatherData) {
  try {
    const response = await axios.post(
      `${AI_SERVICE_URL}/api/predict`,
      weatherData,
      {
        timeout: AI_TIMEOUT_MS,          // ← CRITICAL: chống Node.js hanging
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (status) => status === 200, // chỉ chấp nhận 200
      }
    )

    const floodDepthCm = response.data?.flood_depth_cm
    if (typeof floodDepthCm !== 'number') {
      console.error('[FloodAIService] Response không có flood_depth_cm:', response.data)
      return null
    }

    return floodDepthCm
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      // Timeout – AI service phản hồi chậm hơn AI_TIMEOUT_MS
      console.error(`[FloodAIService] Timeout sau ${AI_TIMEOUT_MS}ms – AI service không phản hồi.`)
    } else if (err.response) {
      // AI service trả HTTP lỗi (4xx / 5xx)
      console.error(
        `[FloodAIService] AI service trả lỗi HTTP ${err.response.status}:`,
        err.response.data
      )
    } else {
      // Lỗi mạng – AI service không chạy / không kết nối được
      console.error('[FloodAIService] Không kết nối được AI service:', err.message)
    }

    // Trả null an toàn – KHÔNG throw để tránh crash toàn bộ Node.js server
    return null
  }
}

// ---------------------------------------------------------------------------
// Ví dụ sử dụng (chạy trực tiếp: node FloodAIService.js)
// ---------------------------------------------------------------------------
if (require.main === module) {
  const mockWeatherData = {
    station_id: 48900,
    year: 2024,
    month: 9,
    day: 15,
    hour: 14,
    temp: 31.5,
    rhum: 85.0,
    prcp: 45.2,   // Lượng mưa cao → kỳ vọng độ ngập lớn
    wspd: 22.0,
    pres: 1008.5,
  }

  console.log('Đang gọi AI service với dữ liệu:', mockWeatherData)

  getFloodPrediction(mockWeatherData).then((result) => {
    if (result === null) {
      console.log('Kết quả: AI service không khả dụng → dùng fallback (null)')
    } else {
      console.log(`Kết quả: Độ ngập dự đoán = ${result} cm`)
    }
  })
}

module.exports = { getFloodPrediction }
