'use strict'

/**
 * OpenMeteoService.js — Landslide Module Weather Fetcher
 * ══════════════════════════════════════════════════════
 * Fetch dữ liệu thời tiết LỊCH SỬ từ Open-Meteo Archive API
 * dành riêng cho Cronjob Sạt lở đất (chạy mỗi 12 giờ).
 *
 * Chiến lược tối ưu cho 425K nodes:
 *   • KHÔNG fetch mỗi node 1 request (→ 425K req/cycle = rate-limit ngay)
 *   • Nhóm nodes theo tỉnh/vùng (unique lat/lon center) → 1 req/tỉnh
 *   • Cache kết quả 12h để tránh gọi lại trong cùng chu kỳ
 *   • Dùng Open-Meteo Archive API (gratis, không cần API key)
 *
 * Dữ liệu trả về (1 điểm lat/lon, n ngày lịch sử):
 *   rain_1d_accum, rain_3d_accum, rain_7d_accum, rain_14d_accum, rain_30d_accum
 *   max_rain_1d_in_7d, max_rain_1d_in_3d
 *   api_7d, api_14d (Antecedent Precipitation Index)
 *   soil_moisture_1d, soil_moisture_7d
 */

const https = require('https')

// ── Cấu hình ────────────────────────────────────────────────────────────────
const OPEN_METEO_ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive'
const OPEN_METEO_FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'

const REQUEST_TIMEOUT_MS = 30_000   // 30s per request
const MAX_RETRIES        = 3
const RETRY_DELAY_MS     = 1_500    // 1.5s giữa các retry

// ── In-memory cache để tránh call lại trong cùng chu kỳ cron ────────────────
// Key: "lat_lon_dateStr" → { data, fetchedAt }
const _cache = new Map()
const CACHE_TTL_MS = 13 * 60 * 60 * 1000 // 13 giờ (hơn 1 chu kỳ cron 12h)

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * HTTP GET helper thuần Node.js (không cần axios — tránh thêm dependency).
 * Tự xử lý redirect và timeout.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(raw)
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${json?.reason ?? raw.slice(0, 120)}`))
          } else {
            resolve(json)
          }
        } catch {
          reject(new Error(`Parse error (status=${res.statusCode}): ${raw.slice(0, 80)}`))
        }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    req.on('error', reject)
  })
}

/**
 * Fetch với retry exponential backoff.
 *
 * @param {string} url
 * @param {number} retries
 * @returns {Promise<object>}
 */
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchJson(url)
    } catch (err) {
      if (attempt === retries) throw err
      const delay = RETRY_DELAY_MS * attempt
      await sleep(delay)
    }
  }
}

/**
 * Sleep async helper.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Tính toán chuỗi ngày YYYY-MM-DD cho n ngày trước hôm nay.
 * @param {number} daysAgo
 * @returns {string}
 */
function dateStr(daysAgo = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

/**
 * Tính API (Antecedent Precipitation Index) với hệ số suy giảm k.
 * API_n = Σ(i=1..n) P_i × k^i
 * Phản ánh mức độ bão hòa đất trước sự kiện mưa.
 *
 * @param {number[]} dailyRain — mảng lượng mưa hàng ngày (index 0 = hôm nay, 1 = hôm qua...)
 * @param {number} nDays
 * @param {number} k — hệ số suy giảm (default 0.9)
 * @returns {number}
 */
function calcAPI(dailyRain, nDays, k = 0.9) {
  let api = 0
  for (let i = 1; i <= Math.min(nDays, dailyRain.length - 1); i++) {
    api += (dailyRain[i] ?? 0) * Math.pow(k, i)
  }
  return api
}

// ── Core fetch function ───────────────────────────────────────────────────────

/**
 * Fetch toàn bộ dữ liệu thời tiết cần cho model sạt lở
 * cho 1 điểm tọa độ (lat, lon).
 *
 * Gọi Archive API lấy 30 ngày lịch sử để tính tất cả biến tích lũy.
 * Kết quả được cache theo key "lat_lon_date" trong 13h.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{
 *   rain_1d_accum: number, rain_3d_accum: number, rain_7d_accum: number,
 *   rain_14d_accum: number, rain_30d_accum: number,
 *   max_rain_1d_in_7d: number, max_rain_1d_in_3d: number,
 *   api_7d: number, api_14d: number,
 *   soil_moisture_1d: number, soil_moisture_7d: number
 * }>}
 */
async function fetchWeatherForNode(lat, lon) {
  // ── Cache check ──────────────────────────────────────────────────────────
  const today = dateStr(0)
  // Nhóm tọa độ theo lưới 0.1 độ (~11km) để tối ưu số lần gọi API (ERA5 độ phân giải gốc cũng chỉ ~30km)
  const gridLat = Math.round(lat * 10) / 10
  const gridLon = Math.round(lon * 10) / 10
  const cacheKey = `${gridLat.toFixed(1)}_${gridLon.toFixed(1)}_${today}`

  const cached = _cache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached.data, _cached: true }
  }

  // ── Build Archive API URL (30 ngày lịch sử) ──────────────────────────────
  // ── Build Forecast API URL (30 ngày lịch sử + 4 ngày forecast) ──────────────────────────────
  const forecastUrl = [
    `${OPEN_METEO_FORECAST_BASE}?`,
    `latitude=${gridLat.toFixed(1)}&longitude=${gridLon.toFixed(1)}`,
    `&past_days=31&forecast_days=4`,
    `&daily=precipitation_sum,soil_moisture_0_to_7cm_mean`,
    `&timezone=Asia/Ho_Chi_Minh`,
  ].join('')

  let forecastData
  try {
    forecastData = await fetchWithRetry(forecastUrl)
  } catch (err) {
    // Nếu fetch fail, trả về giá trị null (sẽ được imputer xử lý)
    console.warn(`[OpenMeteo] Forecast fetch failed (${lat.toFixed(2)},${lon.toFixed(2)}): ${err.message}`)
    return null
  }

  const dailyRain     = forecastData?.daily?.precipitation_sum ?? []
  const dailySoilMois = forecastData?.daily?.soil_moisture_0_to_7cm_mean ?? []

  if (dailyRain.length === 0) {
    console.warn(`[OpenMeteo] Không có dữ liệu mưa (${lat.toFixed(2)},${lon.toFixed(2)})`)
    return null
  }

  const stationForecasts = []

  for (let offset = 0; offset <= 3; offset++) {
    const targetEndIndex = 30 + offset

    const rainDesc = dailyRain.slice(0, targetEndIndex + 1).reverse().map(v => v ?? 0)
    const soilDesc = dailySoilMois.slice(0, targetEndIndex + 1).reverse().map(v => v ?? 0)

    const sumN = (arr, n) => arr.slice(0, n).reduce((a, b) => a + b, 0)
    const maxN = (arr, n) => Math.max(...arr.slice(0, n), 0)

    const rain_1d_accum   = sumN(rainDesc,  1)
    const rain_3d_accum   = sumN(rainDesc,  3)
    const rain_7d_accum   = sumN(rainDesc,  7)
    const rain_14d_accum  = sumN(rainDesc, 14)
    const rain_30d_accum  = sumN(rainDesc, 30)

    const max_rain_1d_in_7d = maxN(rainDesc, 7)
    const max_rain_1d_in_3d = maxN(rainDesc, 3)

    const api_7d  = calcAPI(rainDesc,  7)
    const api_14d = calcAPI(rainDesc, 14)

    const soil_moisture_1d = soilDesc[0] ?? 0
    const soil_moisture_7d = soilDesc.slice(0, 7).reduce((a, b) => a + b, 0) / Math.max(soilDesc.slice(0, 7).filter(v => v > 0).length, 1)

    stationForecasts.push({
      rain_1d_accum:   Math.round(rain_1d_accum  * 100) / 100,
      rain_3d_accum:   Math.round(rain_3d_accum  * 100) / 100,
      rain_7d_accum:   Math.round(rain_7d_accum  * 100) / 100,
      rain_14d_accum:  Math.round(rain_14d_accum * 100) / 100,
      rain_30d_accum:  Math.round(rain_30d_accum * 100) / 100,
      max_rain_1d_in_7d: Math.round(max_rain_1d_in_7d * 100) / 100,
      max_rain_1d_in_3d: Math.round(max_rain_1d_in_3d * 100) / 100,
      api_7d:          Math.round(api_7d          * 100) / 100,
      api_14d:         Math.round(api_14d         * 100) / 100,
      soil_moisture_1d: Math.round(soil_moisture_1d * 10000) / 10000,
      soil_moisture_7d: Math.round(soil_moisture_7d * 10000) / 10000,
      _cached: false
    })
  }

  // ── Lưu cache ────────────────────────────────────────────────────────────
  _cache.set(cacheKey, { data: stationForecasts, fetchedAt: Date.now() })

  // Dọn cache cũ nếu quá lớn (giữ tối đa 5000 entries)
  if (_cache.size > 5000) {
    const firstKey = _cache.keys().next().value
    _cache.delete(firstKey)
  }

  return stationForecasts
}

/**
 * Xóa toàn bộ cache (dùng đầu mỗi chu kỳ cron để luôn lấy data mới nhất).
 */
function clearCache() {
  _cache.clear()
}

/**
 * Trả về thống kê cache hiện tại (debug).
 */
function getCacheStats() {
  return { size: _cache.size, ttlHours: CACHE_TTL_MS / 3_600_000 }
}

/**
 * Fetch toàn bộ dữ liệu thời tiết cho một mảng các trạm (tối đa 50 trạm).
 * @param {Array<{id: string, lat: number, lon: number}>} stations
 * @returns {Promise<Map<string, object|null>>}
 */
async function fetchWeatherForMultipleNodes(stations) {
  const resultDictionary = new Map()
  if (!stations || stations.length === 0) return resultDictionary

  const CHUNK_SIZE = 20;
  let consecutiveErrors = 0;
  for (let c = 0; c < stations.length; c += CHUNK_SIZE) {
    const chunk = stations.slice(c, c + CHUNK_SIZE)
    
    // Open-Meteo Archive API yêu cầu mảng lats, lons cách nhau bằng dấu phẩy
    const lats = chunk.map(s => s.lat.toFixed(1)).join(',')
    const lons = chunk.map(s => s.lon.toFixed(1)).join(',')
    
    const endDate   = dateStr(-3)   // 3 ngày tới (forecast_days=4)
    const startDate = dateStr(31)   // 31 ngày trước

    const forecastUrl = [
      `${OPEN_METEO_FORECAST_BASE}?`,
      `latitude=${lats}&longitude=${lons}`,
      `&past_days=31&forecast_days=4`,
      `&daily=precipitation_sum,soil_moisture_0_to_7cm_mean`,
      `&timezone=Asia/Ho_Chi_Minh`,
    ].join('')

    let forecastData
    try {
      forecastData = await fetchWithRetry(forecastUrl)
      consecutiveErrors = 0 // reset on success
    } catch (err) {
      console.warn(`[OpenMeteo] Batch fetch failed for chunk of ${chunk.length} locations: ${err.message}`)
      for (const st of chunk) {
        resultDictionary.set(st.id, null)
      }
      consecutiveErrors++
      if (consecutiveErrors >= 2) {
        console.error(`[OpenMeteo] ❌ Mạng lỗi hoặc API bị chặn (2 lần liên tiếp). Bỏ qua fetch OpenMeteo cho các trạm còn lại!`)
        // Fill null cho TẤT CẢ các trạm còn lại
        for (let j = c + CHUNK_SIZE; j < stations.length; j++) {
          resultDictionary.set(stations[j].id, null)
        }
        break // Dừng fetch
      }
      continue // Move to next chunk
    }

    // OpenMeteo trả về Array khi request nhiều tọa độ, Object nếu chỉ 1
    const resultsArr = Array.isArray(forecastData) ? forecastData : [forecastData]

    for (let i = 0; i < chunk.length; i++) {
      const station = chunk[i]
      const data = resultsArr[i]

      if (!data || data.error) {
        resultDictionary.set(station.id, null)
        continue
      }

      const dailyRain     = data.daily?.precipitation_sum ?? []
      const dailySoilMois = data.daily?.soil_moisture_0_to_7cm_mean ?? []

      if (dailyRain.length === 0) {
        resultDictionary.set(station.id, null)
        continue
      }

      const stationForecasts = []

      // Lặp 4 mốc thời gian: 0 (Hôm nay), 1 (Ngày mai), 2 (Ngày kia), 3 (Ngày kìa)
      for (let offset = 0; offset <= 3; offset++) {
        // Trong mảng 35 phần tử (past_days=31 + forecast_days=4)
        // Hôm nay luôn ở index 31.
        const targetEndIndex = 30 + offset

        // Lấy lịch sử từ 0 đến targetEndIndex, đảo ngược để index 0 là ngày sát target nhất (hôm qua của target)
        // Lưu ý: data huấn luyện dùng endDate=ngày hôm qua. Nên để tính mốc target, ta dùng lịch sử từ hôm qua trở về trước.
        const rainDesc = dailyRain.slice(0, targetEndIndex + 1).reverse().map(v => v ?? 0)
        const soilDesc = dailySoilMois.slice(0, targetEndIndex + 1).reverse().map(v => v ?? 0)

        const sumN = (arr, n) => arr.slice(0, n).reduce((a, b) => a + b, 0)
        const maxN = (arr, n) => Math.max(...arr.slice(0, n), 0)

        const rain_1d_accum   = sumN(rainDesc,  1)
        const rain_3d_accum   = sumN(rainDesc,  3)
        const rain_7d_accum   = sumN(rainDesc,  7)
        const rain_14d_accum  = sumN(rainDesc, 14)
        const rain_30d_accum  = sumN(rainDesc, 30)

        const max_rain_1d_in_7d = maxN(rainDesc, 7)
        const max_rain_1d_in_3d = maxN(rainDesc, 3)

        const api_7d  = calcAPI(rainDesc,  7)
        const api_14d = calcAPI(rainDesc, 14)

        const soil_moisture_1d = soilDesc[0] ?? 0
        const soil_moisture_7d = soilDesc.slice(0, 7).reduce((a, b) => a + b, 0) / Math.max(soilDesc.slice(0, 7).filter(v => v > 0).length, 1)

        stationForecasts.push({
          rain_1d_accum:   Math.round(rain_1d_accum  * 100) / 100,
          rain_3d_accum:   Math.round(rain_3d_accum  * 100) / 100,
          rain_7d_accum:   Math.round(rain_7d_accum  * 100) / 100,
          rain_14d_accum:  Math.round(rain_14d_accum * 100) / 100,
          rain_30d_accum:  Math.round(rain_30d_accum * 100) / 100,
          max_rain_1d_in_7d: Math.round(max_rain_1d_in_7d * 100) / 100,
          max_rain_1d_in_3d: Math.round(max_rain_1d_in_3d * 100) / 100,
          api_7d:          Math.round(api_7d          * 100) / 100,
          api_14d:         Math.round(api_14d         * 100) / 100,
          soil_moisture_1d: Math.round(soil_moisture_1d * 10000) / 10000,
          soil_moisture_7d: Math.round(soil_moisture_7d * 10000) / 10000,
          _cached: false
        })
      }

      resultDictionary.set(station.id, stationForecasts)
    }

    // Update Cache luôn cho các trạm này để API lẻ tẻ cũng tận dụng được
    const today = dateStr(0)
    for (let i = 0; i < chunk.length; i++) {
      const station = chunk[i]
      const parsedResults = resultDictionary.get(station.id)
      if (parsedResults && Array.isArray(parsedResults)) {
        const cacheKey = `${station.lat.toFixed(1)}_${station.lon.toFixed(1)}_${today}`
        _cache.set(cacheKey, { data: parsedResults, fetchedAt: Date.now() })
      }
    }

    // Nghỉ 6 giây giữa các lô để không vượt quá rate limit của Open-Meteo (nhưng vẫn đủ nhanh)
    if (c + CHUNK_SIZE < stations.length) {
      console.log(`[OpenMeteo] Đã xử lý ${Math.min(c + CHUNK_SIZE, stations.length)}/${stations.length} trạm. Đang đợi 6s...`)
      await sleep(6000)
    }
  }

  // Dọn cache cũ nếu quá lớn
  while (_cache.size > 5000) {
    const firstKey = _cache.keys().next().value
    _cache.delete(firstKey)
  }

  return resultDictionary
}

module.exports = {
  fetchWeatherForNode,
  fetchWeatherForMultipleNodes,
  clearCache,
  getCacheStats,
  sleep,    // re-export để cronjob dùng throttle
}
