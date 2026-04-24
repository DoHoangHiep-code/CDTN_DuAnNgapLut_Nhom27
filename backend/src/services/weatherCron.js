'use strict'

// weatherCron.js – Cronjob tự động dự báo ngập lụt mỗi 6 tiếng
//
// Luồng xử lý:
//  Bước 1 → Lấy danh sách GridNode (lat, lng, node_id, elevation, slope, impervious_ratio)
//  Bước 2 → Gọi Open-Meteo API lấy forecast 4 ngày (96h) cho từng node
//  Bước 3 → Với mỗi giờ forecast: gọi AI FastAPI /api/predict → flood_depth_cm
//  Bước 4 → Tính risk_level + sinh explanation dựa trên dữ liệu
//  Bước 5 → bulkCreate upsert vào bảng flood_predictions
//
// Schedule: "0 */6 * * *"  →  chạy lúc 0h, 6h, 12h, 18h mỗi ngày (ICT)
// Lưu ý: chuỗi cron chứa "*/6" phải đặt trong string, KHÔNG đặt trong block comment
//
// @module weatherCron

require('dotenv').config()

const cron    = require('node-cron')
const axios   = require('axios')

// Import models từ index (đã setup associations)
const { GridNode, FloodPrediction } = require('../models')

// ─── Cấu hình ────────────────────────────────────────────────────────────────

/** URL của FastAPI AI service */
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000'

/** Timeout gọi AI (ms) – không để quá dài tránh blocking */
const AI_TIMEOUT_MS = 8000

/** Timeout gọi Open-Meteo (ms) */
const OPENMETEO_TIMEOUT_MS = 15000

/** Số node xử lý song song mỗi lần để tránh rate-limit Open-Meteo */
const NODE_CONCURRENCY = 3

/** Số giờ forecast lấy từ Open-Meteo (tối đa 240h = 10 ngày, dùng 96h = 4 ngày) */
const FORECAST_HOURS = 96

// ─── Helper: tính risk_level từ flood_depth_cm ───────────────────────────────

/**
 * Tính mức rủi ro ngập dựa trên độ sâu (cm).
 * Đồng bộ với ENUM trong DB: 'safe' | 'medium' | 'high' | 'severe'
 *
 * @param {number} depthCm
 * @returns {'safe'|'medium'|'high'|'severe'}
 */
function calcRiskLevel(depthCm) {
  if (depthCm < 15)  return 'safe'
  if (depthCm < 30)  return 'medium'
  if (depthCm < 60)  return 'high'
  return 'severe'
}

// ─── Helper: sinh explanation văn bản sơ bộ ──────────────────────────────────

/**
 * Sinh mô tả ngắn bằng tiếng Việt dựa trên dữ liệu dự báo.
 *
 * @param {object} opts
 * @param {'safe'|'medium'|'high'|'severe'} opts.riskLevel
 * @param {number} opts.depthCm      – độ sâu ngập dự đoán (cm)
 * @param {number} opts.prcp         – lượng mưa tại giờ đó (mm)
 * @param {number} opts.temp         – nhiệt độ (°C)
 * @returns {string}
 */
function buildExplanation({ riskLevel, depthCm, prcp, temp }) {
  const riskLabel = {
    safe:   'An toàn',
    medium: 'Nguy cơ thấp',
    high:   'Nguy cơ cao',
    severe: 'Nguy hiểm',
  }[riskLevel] ?? riskLevel

  const rainNote = prcp > 0
    ? `Lượng mưa dự báo ${prcp.toFixed(1)} mm/h.`
    : 'Không có mưa.'

  const depthNote = depthCm > 0
    ? `Độ ngập ước tính ${depthCm.toFixed(1)} cm.`
    : 'Khu vực không ngập.'

  return `[${riskLabel}] ${rainNote} ${depthNote} Nhiệt độ ${temp.toFixed(1)}°C.`
}

// ─── Bước 2: Gọi Open-Meteo API ──────────────────────────────────────────────

/**
 * Lấy forecast 96h từ Open-Meteo cho một cặp (lat, lng).
 * Không cần API key – dịch vụ miễn phí.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object|null>} hourly data object hoặc null nếu lỗi
 */
async function fetchOpenMeteoForecast(lat, lng) {
  const url = 'https://api.open-meteo.com/v1/forecast'
  const params = {
    latitude:        lat,
    longitude:       lng,
    hourly:          [
      'temperature_2m',       // nhiệt độ (°C)
      'relative_humidity_2m', // độ ẩm tương đối (%)
      'precipitation',        // lượng mưa (mm/h)
      'surface_pressure',     // áp suất mặt đất (hPa)
      'wind_speed_10m',       // tốc độ gió (km/h)
    ].join(','),
    forecast_days:   4,       // 4 ngày = 96 giờ
    timezone:        'Asia/Ho_Chi_Minh',
  }

  try {
    const res = await axios.get(url, {
      params,
      timeout: OPENMETEO_TIMEOUT_MS,
    })
    return res.data?.hourly ?? null
  } catch (err) {
    console.error(`[WeatherCron] Open-Meteo lỗi (lat=${lat}, lng=${lng}):`, err.message)
    return null
  }
}

// ─── Bước 3: Gọi AI FastAPI ──────────────────────────────────────────────────

/**
 * Gọi AI FastAPI microservice để lấy flood_depth_cm.
 *
 * @param {object} features – object thời tiết theo schema AI service
 * @returns {Promise<number|null>} flood_depth_cm hoặc null nếu AI không khả dụng
 */
async function callAIPredict(features) {
  try {
    const res = await axios.post(
      `${AI_SERVICE_URL}/api/predict`,
      features,
      {
        timeout: AI_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        // Chỉ chấp nhận HTTP 200
        validateStatus: (status) => status === 200,
      }
    )

    const depth = res.data?.flood_depth_cm
    if (typeof depth !== 'number') {
      console.error('[WeatherCron] AI trả về dữ liệu không hợp lệ:', res.data)
      return null
    }

    return depth
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      console.warn(`[WeatherCron] AI timeout sau ${AI_TIMEOUT_MS}ms.`)
    } else {
      console.warn('[WeatherCron] AI không phản hồi:', err.message)
    }
    return null
  }
}

// ─── Bước 1+2+3+4: Xử lý một node ──────────────────────────────────────────

/**
 * Xử lý toàn bộ luồng cho một GridNode:
 *  1. Gọi Open-Meteo lấy 96h forecast
 *  2. Với mỗi giờ: gọi AI → flood_depth_cm
 *  3. Tính risk_level + explanation
 *  4. Trả về mảng record để bulkCreate
 *
 * @param {object} node – GridNode instance (node_id, latitude, longitude, elevation, slope, impervious_ratio)
 * @returns {Promise<Array>} mảng record sẵn sàng insert vào flood_predictions
 */
async function processNode(node) {
  const { node_id, latitude, longitude, elevation, slope, impervious_ratio } = node

  // Bước 2: Lấy forecast từ Open-Meteo
  const hourly = await fetchOpenMeteoForecast(Number(latitude), Number(longitude))
  if (!hourly) {
    console.warn(`[WeatherCron] Bỏ qua node ${node_id} – không lấy được forecast.`)
    return []
  }

  const times   = hourly.time                   // mảng ISO string theo giờ
  const temps   = hourly.temperature_2m          // °C
  const rhums   = hourly.relative_humidity_2m    // %
  const prcps   = hourly.precipitation           // mm/h
  const press   = hourly.surface_pressure        // hPa
  const wspds   = hourly.wind_speed_10m          // km/h

  const records = []

  for (let i = 0; i < Math.min(times.length, FORECAST_HOURS); i++) {
    const forecastTime = new Date(times[i])
    const hour    = forecastTime.getHours()
    const month   = forecastTime.getMonth() + 1
    const dayofweek = forecastTime.getDay() === 0 ? 6 : forecastTime.getDay() - 1 // 0=Mon
    const start   = new Date(forecastTime.getFullYear(), 0, 0)
    const dayofyear = Math.floor((forecastTime - start) / 86_400_000)
    const rainyMonths = [5, 6, 7, 8, 9, 10]

    const temp   = temps[i]  ?? 28
    const rhum   = rhums[i]  ?? 70
    const prcp   = prcps[i]  ?? 0
    const pres   = press[i]  ?? 1010
    // Open-Meteo trả km/h → chuyển sang m/s để đồng nhất với feature AI
    const wspd   = (wspds[i] ?? 0) / 3.6

    // Build feature object khớp với schema AI FastAPI (xem FloodAIService.js)
    const features = {
      prcp,
      prcp_3h:              prcp,   // Không có tích luỹ từ forecast đơn giản → dùng prcp hiện tại
      prcp_6h:              prcp,
      prcp_12h:             prcp,
      prcp_24h:             prcp,
      temp,
      rhum,
      wspd,
      pres,
      pressure_change_24h:  0,      // Không tính được từ forecast đơn giản
      max_prcp_3h:          prcp,
      max_prcp_6h:          prcp,
      max_prcp_12h:         prcp,
      elevation:            Number(elevation)         || 5,
      slope:                Number(slope)             || 1,
      impervious_ratio:     Number(impervious_ratio)  || 0.5,
      dist_to_drain_km:     0.5,    // Giá trị trung bình – không có trong Open-Meteo
      dist_to_river_km:     1.0,
      dist_to_pump_km:      1.0,
      dist_to_main_road_km: 0.3,
      dist_to_park_km:      0.5,
      hour,
      dayofweek,
      month,
      dayofyear,
      hour_sin:  Math.sin((2 * Math.PI * hour)  / 24),
      hour_cos:  Math.cos((2 * Math.PI * hour)  / 24),
      month_sin: Math.sin((2 * Math.PI * month) / 12),
      month_cos: Math.cos((2 * Math.PI * month) / 12),
      rainy_season_flag: rainyMonths.includes(month) ? 1 : 0,
    }

    // Bước 3: Gọi AI FastAPI
    const depthCm = await callAIPredict(features)

    // Nếu AI không phản hồi → bỏ qua giờ này (không insert null)
    if (depthCm === null) continue

    // Bước 4: Tính risk_level + sinh explanation
    const riskLevel   = calcRiskLevel(depthCm)
    const explanation = buildExplanation({ riskLevel, depthCm, prcp, temp })

    records.push({
      node_id,
      time:           forecastTime,
      flood_depth_cm: depthCm,
      risk_level:     riskLevel,
      explanation,
    })
  }

  console.log(`[WeatherCron] Node ${node_id}: ${records.length}/${FORECAST_HOURS} bản ghi hợp lệ.`)
  return records
}

// ─── Bước 5: Upsert vào DB ───────────────────────────────────────────────────

/**
 * Ghi toàn bộ records vào flood_predictions bằng bulkCreate upsert.
 * Nếu (node_id, time) đã tồn tại → cập nhật flood_depth_cm, risk_level, explanation.
 *
 * @param {Array} records
 */
async function upsertPredictions(records) {
  if (!records.length) {
    console.log('[WeatherCron] Không có bản ghi nào để upsert.')
    return
  }

  await FloodPrediction.bulkCreate(records, {
    // updateOnDuplicate hoạt động nhờ unique constraint uq_floodpred_node_time
    updateOnDuplicate: ['flood_depth_cm', 'risk_level', 'explanation'],
  })

  console.log(`[WeatherCron] ✅ Đã upsert ${records.length} bản ghi vào flood_predictions.`)
}

// ─── Hàm chính: runWeatherCron ───────────────────────────────────────────────

/**
 * Hàm chính của Cronjob:
 *  1. Lấy tất cả GridNode từ DB
 *  2. Xử lý từng nhóm NODE_CONCURRENCY nodes song song
 *  3. Gom tất cả records → upsert vào DB
 */
async function runWeatherCron() {
  const startTime = Date.now()
  console.log(`\n[WeatherCron] ⏰ Bắt đầu lúc ${new Date().toISOString()}`)

  try {
    // Bước 1: Lấy danh sách tất cả GridNode từ DB
    const nodes = await GridNode.findAll({
      attributes: ['node_id', 'latitude', 'longitude', 'elevation', 'slope', 'impervious_ratio'],
    })

    if (!nodes.length) {
      console.warn('[WeatherCron] Không có GridNode nào trong DB. Dừng.')
      return
    }

    console.log(`[WeatherCron] Tổng số node: ${nodes.length}. Xử lý theo nhóm ${NODE_CONCURRENCY}.`)

    const allRecords = []

    // Xử lý theo từng chunk để tránh quá tải Open-Meteo và AI service
    for (let i = 0; i < nodes.length; i += NODE_CONCURRENCY) {
      const chunk = nodes.slice(i, i + NODE_CONCURRENCY)

      // Xử lý song song trong nhóm
      const chunkResults = await Promise.allSettled(
        chunk.map((node) => processNode(node.toJSON()))
      )

      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          allRecords.push(...result.value)
        } else {
          console.error('[WeatherCron] Lỗi xử lý node:', result.reason)
        }
      }

      // Delay nhỏ giữa các chunk để tránh rate-limit (100ms)
      if (i + NODE_CONCURRENCY < nodes.length) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    // Bước 5: Upsert toàn bộ records vào DB
    await upsertPredictions(allRecords)

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[WeatherCron] 🏁 Hoàn thành sau ${elapsed}s. Tổng: ${allRecords.length} bản ghi.\n`)
  } catch (err) {
    console.error('[WeatherCron] ❌ Lỗi nghiêm trọng:', err)
    // KHÔNG throw – tránh crash toàn bộ server nếu cron gặp lỗi
  }
}

// ─── Khởi động Cronjob ───────────────────────────────────────────────────────

/**
 * Đăng ký cron task chạy mỗi 6 tiếng (0h, 6h, 12h, 18h).
 * Được gọi một lần khi server khởi động (từ server.js).
 */
function startWeatherCron() {
  // Schedule: phút 0 của mỗi 6 tiếng
  cron.schedule('0 */6 * * *', () => {
    console.log('[WeatherCron] Cron trigger tự động...')
    runWeatherCron()
  }, {
    timezone: 'Asia/Ho_Chi_Minh', // Múi giờ Việt Nam
  })

  console.log('[WeatherCron] ✅ Đã đăng ký cron schedule: mỗi 6 tiếng (0h/6h/12h/18h ICT).')
}

/**
 * manualTrigger – Kích hoạt Cronjob ngay lập tức để test.
 * Gọi từ route GET /api/v1/cron/trigger hoặc CLI.
 *
 * @returns {Promise<void>}
 */
async function manualTrigger() {
  console.log('[WeatherCron] 🔧 Manual trigger được gọi...')
  await runWeatherCron()
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { startWeatherCron, manualTrigger }
