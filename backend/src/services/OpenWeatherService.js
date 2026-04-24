'use strict'

/**
 * OpenWeatherService – gọi OpenWeatherMap Current Weather API theo tọa độ.
 *
 * Docs: https://openweathermap.org/current
 * Endpoint: GET https://api.openweathermap.org/data/2.5/weather
 *
 * Cấu hình: đặt OPENWEATHER_API_KEY vào file .env
 * Fallback: nếu key không tồn tại hoặc API lỗi → trả null (không crash server)
 */

const axios = require('axios')

const OWM_BASE = 'https://api.openweathermap.org/data/2.5/weather'
const OWM_TIMEOUT_MS = 6000 // 6 giây – tránh treo request

/**
 * Lấy dữ liệu thời tiết hiện tại từ OpenWeatherMap theo tọa độ GPS.
 *
 * @param {number} lat - Vĩ độ (latitude)
 * @param {number} lon - Kinh độ (longitude)
 * @returns {Promise<{
 *   rain1h: number,
 *   humidity: number,
 *   clouds: number,
 *   temp: number,
 *   description: string
 * } | null>}
 *
 * Trả null nếu:
 *   - OPENWEATHER_API_KEY chưa được set
 *   - API key không hợp lệ / hết hạn
 *   - Timeout hoặc lỗi mạng
 */
async function getWeatherByCoords(lat, lon) {
  const apiKey = process.env.OPENWEATHER_API_KEY

  // Kiểm tra key tồn tại
  if (!apiKey || apiKey === 'your_openweathermap_api_key_here') {
    console.warn('[OpenWeatherService] OPENWEATHER_API_KEY chưa được cấu hình trong .env')
    return null
  }

  try {
    const res = await axios.get(OWM_BASE, {
      params: {
        lat,
        lon,
        appid: apiKey,
        units: 'metric', // Kelvin → Celsius tự động
        lang: 'vi',      // Mô tả thời tiết bằng tiếng Việt
      },
      timeout: OWM_TIMEOUT_MS,
    })

    const d = res.data

    return {
      // Lượng mưa 1h qua (mm) – trường có thể vắng mặt nếu không mưa
      rain1h: d?.rain?.['1h'] ?? 0,

      // Độ ẩm tương đối (%)
      humidity: d?.main?.humidity ?? 0,

      // Độ che phủ mây (%)
      clouds: d?.clouds?.all ?? 0,

      // Nhiệt độ (°C) – đã convert nhờ units=metric
      temp: d?.main?.temp ?? 0,

      // Mô tả ngắn gọn về thời tiết
      description: d?.weather?.[0]?.description ?? 'Không rõ',

      // Thêm tốc độ gió phòng khi cần dùng cho model (m/s)
      windSpeed: d?.wind?.speed ?? 0,

      // Áp suất khí quyển (hPa)
      pressure: d?.main?.pressure ?? 1013,
    }
  } catch (err) {
    // Phân loại lỗi để log rõ ràng hơn
    if (err.code === 'ECONNABORTED') {
      console.error(`[OpenWeatherService] Timeout sau ${OWM_TIMEOUT_MS}ms khi gọi API.`)
    } else if (err.response?.status === 401) {
      console.error('[OpenWeatherService] API key không hợp lệ hoặc đã hết hạn (HTTP 401).')
    } else if (err.response?.status === 429) {
      console.error('[OpenWeatherService] Vượt quá giới hạn request (HTTP 429 Too Many Requests).')
    } else {
      console.error('[OpenWeatherService] Lỗi khi gọi OpenWeatherMap:', err.message)
    }

    // Trả null an toàn – không throw để tránh crash toàn bộ server
    return null
  }
}

module.exports = { getWeatherByCoords }
