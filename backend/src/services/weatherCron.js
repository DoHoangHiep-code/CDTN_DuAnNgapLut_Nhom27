'use strict'

// weatherCron.js – Cronjob tự động dự báo ngập lụt mỗi 6 tiếng
//
// Nguồn dữ liệu thời tiết (DUY NHẤT): OpenWeatherMap Developer Plan
//   • Current weather : GET /data/2.5/weather   (8 calls/lần – 8 trạm)
//   • 5-Day Forecast  : GET /data/2.5/forecast  (8 calls/lần – 40 points × 3h)
//
// Luồng xử lý:
//   Phase 0 → Lấy weather hiện tại OWM cho 8 trạm → fan-out → weather_measurements
//   Phase 1 → Lấy forecast 5d OWM cho 8 trạm (song song)
//   Phase 2 → Với mỗi trạm: lấy GridNode trong cụm → processNode → AI batch
//   Phase 3 → bulkCreate upsert flood_predictions + weather_measurements
//
// Schedule: "0 */6 * * *" → 0h, 6h, 12h, 18h ICT
//
// @module weatherCron

require('dotenv').config()

const WEATHER_STATIONS = require('../../config/weatherStations')

const cron       = require('node-cron')
const axiosRetry = require('axios-retry').default || require('axios-retry')
const axios      = require('axios')

axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) =>
    error.code === 'ECONNABORTED' || axiosRetry.isNetworkOrIdempotentRequestError(error),
})

const { getWeatherByCoords, getOWMForecast5d } = require('./OpenWeatherService')
const { GridNode, FloodPrediction, WeatherMeasurement, SystemLog } = require('../models')

// ─── Cấu hình ────────────────────────────────────────────────────────────────

const AI_SERVICE_URL  = process.env.AI_SERVICE_URL || 'http://localhost:8000'
const AI_TIMEOUT_MS   = 10000   // 10 giây
const NODE_BATCH_SIZE = 50      // Số node xử lý song song mỗi lần

/**
 * PREDICTION_UPSERT_STRATEGY:
 * - 'UPDATE_RECENT_ONLY' (mặc định): Chỉ UPDATE predictions trong 6-12h tiếp theo
 *   Cách hoạt động: UPDATE (6-12h tiếp theo) + INSERT (> 12h) + SKIP (quá khứ)
 *   Lợi ích: Tránh ghi đè dự báo dài hạn, vẫn cập nhật thời tiết gần
 * 
 * - 'INSERT_ONLY': Chỉ INSERT predictions mới, không UPDATE gì cả
 *   Cách hoạt động: Tất cả dùng ignoreDuplicates = true
 *   Lợi ích: Giữ nguyên 100% dữ liệu cũ
 * 
 * - 'FULL_UPDATE': UPDATE tất cả (behavior cũ)
 *   Cách hoạt động: updateOnDuplicate = true cho tất cả
 *   Cảnh báo: Sẽ ghi đè toàn bộ dữ liệu cũ mỗi lần chạy
 */
const PREDICTION_UPSERT_STRATEGY = process.env.PREDICTION_UPSERT_STRATEGY || 'UPDATE_RECENT_ONLY'

// ─── Helper: tính risk_level ──────────────────────────────────────────────────

function calcRiskLevel(depthCm) {
  if (depthCm < 15) return 'safe'
  if (depthCm < 30) return 'medium'
  if (depthCm < 60) return 'high'
  return 'severe'
}

// ─── Helper: sinh explanation ─────────────────────────────────────────────────

function buildExplanation({ riskLevel, depthCm, prcp, temp }) {
  const riskLabel = { safe: 'An toàn', medium: 'Nguy cơ thấp', high: 'Nguy cơ cao', severe: 'Nguy hiểm' }[riskLevel] ?? riskLevel
  const rainNote  = prcp > 0 ? `Lượng mưa dự báo ${prcp.toFixed(1)} mm/3h.` : 'Không có mưa.'
  const depthNote = depthCm > 0 ? `Độ ngập ước tính ${depthCm.toFixed(1)} cm.` : 'Khu vực không ngập.'
  return `[${riskLabel}] ${rainNote} ${depthNote} Nhiệt độ ${temp.toFixed(1)}°C.`
}

// ─── Phase 0: Ingest current weather từ OWM → fan-out weather_measurements ───

async function ingestCurrentWeatherFromOWM() {
  const now       = new Date()
  const date_only = now.toISOString().slice(0, 10)
  const rainyMonths = [5, 6, 7, 8, 9, 10]
  const nowICT = new Date(now.getTime() + 7 * 3600 * 1000)
  const hour   = nowICT.getUTCHours()
  const month  = nowICT.getUTCMonth() + 1
  const rainy_season_flag = rainyMonths.includes(month)

  console.log('[WeatherCron/OWM] Fetch current weather cho 8 trạm...')
  const stationWeatherMap = new Map()

  await Promise.allSettled(
    WEATHER_STATIONS.map(async (station) => {
      const w = await getWeatherByCoords(station.lat, station.lon)
      if (w) {
        stationWeatherMap.set(station.id, w)
        console.log(`  [Trạm ${station.id}] ✅ ${station.name} — temp=${w.temp}°C rain=${w.rain1h}mm`)
      } else {
        console.warn(`  [Trạm ${station.id}] ⚠️  ${station.name} — OWM thất bại`)
      }
    })
  )
  console.log(`[WeatherCron/OWM] Lấy được ${stationWeatherMap.size}/8 trạm.\n`)

  if (!stationWeatherMap.size) return 0

  const nodes = await GridNode.findAll({
    attributes: ['node_id', 'weather_station_id', 'location_name'],
    raw: true,
  })

  const records = []
  for (const node of nodes) {
    const stationId = node.weather_station_id ?? 1
    const w = stationWeatherMap.get(stationId) ?? stationWeatherMap.values().next().value
    if (!w) continue

    records.push({
      node_id:       node.node_id,
      time:          now,
      date_only,
      month,
      hour,
      rainy_season_flag,
      temp:          Number(w.temp)      || 0,
      rhum:          Number(w.humidity)  || 0,
      prcp:          Number(w.rain1h)    || 0,
      prcp_3h:       Number(w.rain1h)    || 0,
      prcp_6h:       Number(w.rain1h)    || 0,
      prcp_12h:      Number(w.rain1h)    || 0,
      prcp_24h:      Number(w.rain1h)    || 0,
      wspd:          Number(w.windSpeed) || 0,
      wdir:          Number(w.windDeg)   || 0,
      pres:          Number(w.pressure)  || 1013,
      pressure_change_24h: 0,
      max_prcp_3h:   Number(w.rain1h)    || 0,
      max_prcp_6h:   Number(w.rain1h)    || 0,
      max_prcp_12h:  Number(w.rain1h)    || 0,
      location_name: node.location_name ?? null,
      visibility_km: w.visibility != null ? (w.visibility / 1000) : null,
      feels_like_c:  Number(w.feels_like) || 0,
    })
  }

  if (!records.length) return 0

  const BATCH = 500
  let written = 0
  for (let i = 0; i < records.length; i += BATCH) {
    await WeatherMeasurement.bulkCreate(records.slice(i, i + BATCH), {
      conflictAttributes: ['node_id', 'time'],
      updateOnDuplicate: [
        'temp', 'rhum', 'prcp', 'prcp_3h', 'prcp_6h', 'prcp_12h', 'prcp_24h',
        'wspd', 'wdir', 'pres', 'date_only', 'month', 'hour', 'rainy_season_flag',
        'pressure_change_24h', 'max_prcp_3h', 'max_prcp_6h', 'max_prcp_12h',
        'location_name', 'visibility_km', 'feels_like_c',
      ],
    })
    written += Math.min(BATCH, records.length - i)
  }

  console.log(`[WeatherCron/OWM] ✅ Đã ghi ${written.toLocaleString('vi-VN')} dòng weather_measurements.`)
  return written
}

// ─── Gọi AI batch ─────────────────────────────────────────────────────────────

async function callAIPredictBatch(featuresArray) {
  if (!featuresArray || !featuresArray.length) return []
  try {
    const res = await axios.post(
      `${AI_SERVICE_URL}/api/predict/batch`,
      featuresArray,
      {
        timeout: AI_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (status) => status === 200,
      }
    )
    if (!Array.isArray(res.data)) {
      console.error('[WeatherCron] AI trả về dữ liệu không hợp lệ:', res.data)
      return null
    }
    return res.data
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      console.warn(`[WeatherCron] AI timeout sau ${AI_TIMEOUT_MS}ms.`)
    } else {
      console.warn('[WeatherCron] AI không phản hồi:', err.message)
    }
    return null
  }
}

// ─── Xử lý một node với OWM forecast data points (mảng 3h) ───────────────────

/**
 * Xử lý một GridNode với mảng data points OWM 3h đã fetch sẵn cho trạm.
 *
 * @param {object}  node       – GridNode plain object
 * @param {Array}   owmPoints  – output của getOWMForecast5d() cho trạm đó
 * @returns {Promise<{predictionRecords: Array, weatherRecords: Array}>}
 */
async function processNodeWithOWMForecast(node, owmPoints) {
  const {
    node_id, elevation, slope, impervious_ratio,
    location_name = null,
  } = node

  if (!owmPoints || !owmPoints.length) {
    return { predictionRecords: [], weatherRecords: [] }
  }

  const rainyMonths   = [5, 6, 7, 8, 9, 10]
  const featuresArray = []
  const originalData  = []
  const weatherRecords = []

  for (let i = 0; i < owmPoints.length; i++) {
    const p    = owmPoints[i]
    const ictMs = p.timeUtc.getTime() + 7 * 3600 * 1000
    const dt    = new Date(ictMs)

    const hour      = dt.getHours()
    const month     = dt.getMonth() + 1
    const dayofweek = dt.getDay() === 0 ? 6 : dt.getDay() - 1
    const start     = new Date(dt.getFullYear(), 0, 0)
    const dayofyear = Math.floor((dt - start) / 86400000)
    const date_only = dt.toISOString().slice(0, 10)
    const rainy_season_flag = rainyMonths.includes(month)

    const temp = p.temp
    const feels_like_c = p.feels_like
    const rhum = p.humidity
    const prcp = p.rain3h            // mm trong 3h
    const pres = p.pressure
    const wspd = p.windSpeed         // m/s – đúng đơn vị AI expect
    const wdir = p.windDeg
    const visibility_km = p.visibility != null ? (p.visibility / 1000) : null

    // Tính prcp windows từ sliding window trên mảng 3h
    // Mỗi step = 3h → prcp_3h = 1 step, prcp_6h = 2 step, prcp_12h = 4 step, prcp_24h = 8 step
    const rain = (stepsBack) => {
      let total = 0
      for (let j = 0; j < stepsBack && i - j >= 0; j++) {
        total += owmPoints[i - j]?.rain3h ?? 0
      }
      return total
    }
    const prcp_3h  = rain(1)
    const prcp_6h  = rain(2)
    const prcp_12h = rain(4)
    const prcp_24h = rain(8)

    featuresArray.push({
      prcp, prcp_3h, prcp_6h, prcp_12h, prcp_24h,
      temp, rhum, wspd, pres,
      pressure_change_24h: 0,
      max_prcp_3h:  prcp_3h,
      max_prcp_6h:  prcp_6h,
      max_prcp_12h: prcp_12h,
      elevation:        Number(elevation)        || 5,
      slope:            Number(slope)            || 1,
      impervious_ratio: Number(impervious_ratio) || 0.5,
      dist_to_drain_km:    0.5,
      dist_to_river_km:    1.0,
      dist_to_pump_km:     1.0,
      dist_to_main_road_km: 0.3,
      dist_to_park_km:     0.5,
      hour, dayofweek, month, dayofyear,
      hour_sin:  Math.sin((2 * Math.PI * hour)  / 24),
      hour_cos:  Math.cos((2 * Math.PI * hour)  / 24),
      month_sin: Math.sin((2 * Math.PI * month) / 12),
      month_cos: Math.cos((2 * Math.PI * month) / 12),
      rainy_season_flag: rainyMonths.includes(month) ? 1 : 0,
    })

    originalData.push({
      forecastTime: p.timeUtc,   // UTC
      prcp, temp, date_only, month, hour, rainy_season_flag,
      visibility_km,
      feels_like_c,
    })

    weatherRecords.push({
      node_id,
      time:         p.timeUtc,
      date_only,
      month,
      hour,
      rainy_season_flag: rainyMonths.includes(month) ? true : false,
      location_name,
      temp,
      rhum,
      prcp,
      prcp_3h,
      prcp_6h,
      prcp_12h,
      prcp_24h,
      wspd,
      wdir,
      pres,
      pressure_change_24h: 0,
      max_prcp_3h:  prcp_3h,
      max_prcp_6h:  prcp_6h,
      max_prcp_12h: prcp_12h,
      visibility_km,
      feels_like_c,
    })
  }

  // Gọi AI batch
  const batchResults = await callAIPredictBatch(featuresArray)
  if (!batchResults) return { predictionRecords: [], weatherRecords }

  const predictionRecords = []
  for (let i = 0; i < batchResults.length; i++) {
    const result = batchResults[i]
    if (!result || result.flood_depth_cm == null) continue

    const depthCm     = Number(result.flood_depth_cm)
    const riskLevel   = calcRiskLevel(depthCm)
    const explanation = buildExplanation({
      riskLevel, depthCm,
      prcp: originalData[i].prcp,
      temp: originalData[i].temp,
    })
    const { forecastTime, date_only, month, hour, rainy_season_flag } = originalData[i]

    predictionRecords.push({
      node_id,
      time:           forecastTime,
      date_only,
      month,
      hour,
      rainy_season_flag,
      flood_depth_cm: depthCm,
      risk_level:     riskLevel,
      explanation,
      location_name,
    })
  }

  return { predictionRecords, weatherRecords }
}

// ─── Upsert weather_measurements ─────────────────────────────────────────────

async function upsertWeatherMeasurements(records) {
  if (!records.length) return
  const BATCH_SIZE = 500
  let total = 0
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    await WeatherMeasurement.bulkCreate(records.slice(i, i + BATCH_SIZE), {
      conflictAttributes: ['node_id', 'time'],
      updateOnDuplicate: [
        'temp', 'rhum', 'prcp', 'prcp_3h', 'prcp_6h', 'prcp_12h', 'prcp_24h',
        'wspd', 'wdir', 'pres', 'date_only',
        'visibility_km', 'feels_like_c',
        'month', 'hour', 'rainy_season_flag', 'location_name',
      ],
    })
    total += Math.min(BATCH_SIZE, records.length - i)
  }
  console.log(`[WeatherCron] ✅ Đã cập nhật ${total.toLocaleString('vi-VN')} dòng weather_measurements.`)
}

// ─── Upsert flood_predictions (với strategy tránh ghi đè) ────────────────────

/**
 * Upsert predictions với strategy tránh ghi đè dữ liệu cũ
 * 
 * Strategy: UPDATE_RECENT_ONLY (mặc định)
 *   - UPDATE: predictions nằm trong 6h-12h tiếp theo từ NOW (to sync weather updates)
 *   - INSERT: predictions nằm ngoài window trên (để giữ dự báo dài hạn)
 *   - SKIP: predictions nằm trong quá khứ
 * 
 * @param {Array} records - Predictions cần upsert
 * @param {string} strategy - 'UPDATE_RECENT_ONLY' | 'FULL_UPDATE' | 'INSERT_ONLY'
 */
async function upsertPredictions(records, strategy = 'UPDATE_RECENT_ONLY') {
  if (!records.length) {
    console.log('[WeatherCron] Không có bản ghi nào để upsert.')
    return
  }

  const now = new Date()
  const recentWindowStart = new Date(now.getTime() + 6 * 3600 * 1000)      // NOW + 6h
  const recentWindowEnd = new Date(now.getTime() + 12 * 3600 * 1000)        // NOW + 12h

  if (strategy === 'UPDATE_RECENT_ONLY') {
    // ── Chia records thành 3 nhóm: past, recent, future ─────────────────────
    const pastRecords = []
    const recentRecords = []
    const futureRecords = []

    for (const rec of records) {
      const recTime = new Date(rec.time)
      if (recTime < now) {
        // Bỏ qua: dự báo trong quá khứ không hợp lệ
        pastRecords.push(rec)
      } else if (recTime >= recentWindowStart && recTime <= recentWindowEnd) {
        // Update: dự báo trong 6-12h tiếp theo (có thể weather thay đổi)
        recentRecords.push(rec)
      } else {
        // Insert: dự báo xa hơn 12h (giữ nguyên dự báo dài hạn)
        futureRecords.push(rec)
      }
    }

    console.log(`[WeatherCron/Upsert] Strategy: UPDATE_RECENT_ONLY`)
    console.log(`  - Past (skipped): ${pastRecords.length}`)
    console.log(`  - Recent (UPDATE 6-12h): ${recentRecords.length}`)
    console.log(`  - Future (INSERT >12h): ${futureRecords.length}`)

    // Upsert recent records WITH updateOnDuplicate (cho phép weather update)
    if (recentRecords.length) {
      const BATCH_SIZE = 200
      for (let i = 0; i < recentRecords.length; i += BATCH_SIZE) {
        await FloodPrediction.bulkCreate(recentRecords.slice(i, i + BATCH_SIZE), {
          conflictAttributes: ['node_id', 'time'],
          updateOnDuplicate: [
            'flood_depth_cm', 'risk_level', 'explanation',
            'date_only', 'month', 'hour', 'rainy_season_flag', 'location_name',
          ],
        })
      }
      console.log(`  ✅ Updated ${recentRecords.length} predictions trong 6-12h tiếp theo`)
    }

    // Insert future records WITHOUT updateOnDuplicate (tránh ghi đè)
    if (futureRecords.length) {
      const BATCH_SIZE = 200
      for (let i = 0; i < futureRecords.length; i += BATCH_SIZE) {
        const batch = futureRecords.slice(i, i + BATCH_SIZE)
        try {
          await FloodPrediction.bulkCreate(batch, {
            ignoreDuplicates: true,  // Bỏ qua nếu đã tồn tại
          })
        } catch (err) {
          console.warn(`[WeatherCron] Lỗi insert future batch ${i}:`, err.message)
        }
      }
      console.log(`  ✅ Inserted ${futureRecords.length} predictions mới cho tương lai`)
    }

    const totalUpserted = recentRecords.length + futureRecords.length
    console.log(`[WeatherCron] ✅ Tổng cộng upsert ${totalUpserted} predictions (skipped ${pastRecords.length})`)

    // Ghi log
    try {
      await SystemLog.create({
        admin_id: null,
        event_type: 'CRONJOB_WEATHER',
        event_source: 'services/weatherCron (OWM)',
        message: `Cronjob hoàn thành: ${recentRecords.length} updated (6-12h), ${futureRecords.length} inserted (>12h), ${pastRecords.length} skipped (past)`,
        timestamp: new Date(),
      })
    } catch (logErr) {
      console.warn('[WeatherCron] Không ghi được SystemLog:', logErr.message)
    }
  } else if (strategy === 'INSERT_ONLY') {
    // ── Chỉ INSERT, không UPDATE bất cứ gì ────────────────────────────────
    const BATCH_SIZE = 200
    let insertedCount = 0
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE)
      try {
        const result = await FloodPrediction.bulkCreate(batch, {
          ignoreDuplicates: true,
        })
        insertedCount += result.length
      } catch (err) {
        console.warn(`[WeatherCron] Lỗi insert batch ${i}:`, err.message)
      }
    }
    console.log(`[WeatherCron] ✅ Strategy INSERT_ONLY: inserted ${insertedCount} predictions`)
  } else {
    // ── FULL_UPDATE: update tất cả (giữ lại behavior cũ) ──────────────────
    const BATCH_SIZE = 200
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      await FloodPrediction.bulkCreate(records.slice(i, i + BATCH_SIZE), {
        conflictAttributes: ['node_id', 'time'],
        updateOnDuplicate: [
          'flood_depth_cm', 'risk_level', 'explanation',
          'date_only', 'month', 'hour', 'rainy_season_flag', 'location_name',
        ],
      })
    }
    console.log(`[WeatherCron] ✅ Strategy FULL_UPDATE: upsert ${records.length} predictions`)
  }
}

// ─── Hàm chính: runWeatherCron ────────────────────────────────────────────────

/**
 * Kiến trúc "Trạm Đại Diện" (Station Clustering) với nguồn dữ liệu OWM:
 *
 *  Phase 0 – OWM Current (8 calls): Lấy thời tiết hiện tại → fan-out weather_measurements
 *  Phase 1 – OWM Forecast 5d (8 calls): Lấy 40 data points × 3h cho 8 trạm
 *  Phase 2 – AI Inference: Mỗi node trong cụm dùng forecast của trạm → gọi AI batch
 *  Phase 3 – Upsert: flood_predictions + weather_measurements lên Aiven
 *
 * Tổng API calls: 8 (current) + 8 (forecast) = 16 calls/lần chạy
 */
async function runWeatherCron() {
  const startTime = Date.now()
  console.log(`\n[WeatherCron] ⏰ Bắt đầu lúc ${new Date().toISOString()} (OWM Station-based)`)
  console.log(`[WeatherCron] Số trạm đại diện: ${WEATHER_STATIONS.length}`)
  console.log(`[WeatherCron] Nguồn dữ liệu: OpenWeatherMap /data/2.5/forecast (5d/3h)`)

  try {
    console.log('[WeatherCron] Đang dọn dẹp dữ liệu cũ (TRUNCATE) để tiết kiệm dung lượng DB...')
    const { sequelize } = require('../models/index')
    await sequelize.query('TRUNCATE TABLE weather_measurements CASCADE;')
    await sequelize.query('TRUNCATE TABLE flood_predictions CASCADE;')
    console.log('[WeatherCron] ✅ Đã TRUNCATE xong.')
  } catch (err) {
    console.warn('[WeatherCron] ⚠️ Không thể TRUNCATE (DB có thể đang bị khoá Read-Only):', err.message)
  }

  try {
    // ── Phase 0: Ingest current weather từ OWM ───────────────────────────────
    const owmRows = await ingestCurrentWeatherFromOWM()
    console.log(`[WeatherCron/OWM] Fan-out xong: ${owmRows.toLocaleString('vi-VN')} bản ghi.\n`)

    // ── Phase 1: Fetch OWM Forecast 5d cho 8 trạm song song ─────────────────
    console.log('\n[Phase 1] Fetch OWM Forecast 5d cho 8 trạm...')
    const stationForecasts = new Map()   // stationId → owmPoints[]

    await Promise.allSettled(
      WEATHER_STATIONS.map(async (station) => {
        const points = await getOWMForecast5d(station.lat, station.lon)
        if (points && points.length) {
          stationForecasts.set(station.id, points)
          console.log(`  [Trạm ${station.id}] ✅ ${station.name} — ${points.length} data points (${(points.length * 3)}h)`)
        } else {
          console.warn(`  [Trạm ${station.id}] ⚠️  ${station.name} — fetch thất bại`)
        }
      })
    )
    console.log(`[Phase 1] ✅ Lấy được ${stationForecasts.size}/${WEATHER_STATIONS.length} trạm.\n`)

    let totalPredictions    = 0
    let totalWeatherRows    = 0
    let totalNodesProcessed = 0

    // ── Phase 2: Xử lý từng trạm ─────────────────────────────────────────────
    for (const station of WEATHER_STATIONS) {
      const owmPoints = stationForecasts.get(station.id)
      if (!owmPoints) {
        console.warn(`[Phase 2] Bỏ qua trạm ${station.id} – không có forecast.`)
        continue
      }

      // Lấy tất cả nodes thuộc trạm này
      const stationNodes = await GridNode.findAll({
        attributes: [
          'node_id', 'latitude', 'longitude',
          'elevation', 'slope', 'impervious_ratio',
          'location_name', 'weather_station_id',
        ],
        where: { weather_station_id: station.id },
        raw:   true,
      })

      if (!stationNodes.length) {
        console.log(`  [Trạm ${station.id}] 0 nodes — bỏ qua.`)
        continue
      }

      console.log(`\n[Trạm ${station.id}] ${station.name} — ${stationNodes.length.toLocaleString('vi-VN')} nodes`)

      const stationPredictions = []
      const stationWeather     = []

      for (let bi = 0; bi < stationNodes.length; bi += NODE_BATCH_SIZE) {
        const nodeBatch  = stationNodes.slice(bi, bi + NODE_BATCH_SIZE)
        const batchRes   = await Promise.allSettled(
          nodeBatch.map(node => processNodeWithOWMForecast(node, owmPoints))
        )

        for (const r of batchRes) {
          if (r.status === 'fulfilled' && r.value) {
            stationPredictions.push(...r.value.predictionRecords)
            stationWeather.push(...r.value.weatherRecords)
          }
        }

        const done = Math.min(bi + NODE_BATCH_SIZE, stationNodes.length)
        const pct  = ((done / stationNodes.length) * 100).toFixed(0)
        process.stdout.write(`\r  Tiến độ: ${done}/${stationNodes.length} (${pct}%)   `)
      }
      console.log('')

      // Upsert kết quả của trạm này (với strategy tránh ghi đè dữ liệu lâu)
      await upsertPredictions(stationPredictions, PREDICTION_UPSERT_STRATEGY)
      await upsertWeatherMeasurements(stationWeather)

      totalPredictions    += stationPredictions.length
      totalWeatherRows    += stationWeather.length
      totalNodesProcessed += stationNodes.length
      console.log(`  [Trạm ${station.id}] ✅ ${stationPredictions.length} predictions, ${stationWeather.length} weather rows`)
    }

    // ── Fallback: nodes chưa có station_id ───────────────────────────────────
    const { Op } = require('sequelize')
    const unassignedNodes = await GridNode.findAll({
      attributes: ['node_id', 'latitude', 'longitude', 'elevation', 'slope', 'impervious_ratio', 'location_name'],
      where:  { weather_station_id: { [Op.is]: null } },
      limit:  100,
      raw:    true,
    })
    if (unassignedNodes.length > 0) {
      console.log(`\n[Fallback] ${unassignedNodes.length} nodes chưa có station_id → dùng Trạm 1 (Hoàn Kiếm)`)
      const fallbackPoints = stationForecasts.get(1) ?? stationForecasts.values().next().value
      if (fallbackPoints) {
        const fallbackPreds   = []
        const fallbackWeather = []
        for (const node of unassignedNodes) {
          const r = await processNodeWithOWMForecast(node, fallbackPoints)
          if (r) {
            fallbackPreds.push(...r.predictionRecords)
            fallbackWeather.push(...r.weatherRecords)
          }
        }
        await upsertPredictions(fallbackPreds, PREDICTION_UPSERT_STRATEGY)
        await upsertWeatherMeasurements(fallbackWeather)
        totalPredictions += fallbackPreds.length
      }
    }

    // ── Ghi SystemLog tổng hợp ───────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    try {
      await SystemLog.create({
        admin_id:     null,
        event_type:   'CRONJOB_WEATHER',
        event_source: 'services/weatherCron (OWM station-based)',
        message:      `Cronjob hoàn thành: stations=${stationForecasts.size}, nodes=${totalNodesProcessed}, ` +
                      `predictions=${totalPredictions}, weather=${totalWeatherRows}, elapsed=${elapsed}s`,
        timestamp:    new Date(),
      })
    } catch (logErr) {
      console.warn('[WeatherCron] Không ghi được SystemLog:', logErr.message)
    }

    console.log(`\n[WeatherCron] 🏁 Hoàn thành sau ${elapsed}s`)
    console.log(`  API nguồn          : OpenWeatherMap /data/2.5/forecast`)
    console.log(`  Trạm fetch OK      : ${stationForecasts.size}/${WEATHER_STATIONS.length}`)
    console.log(`  Nodes xử lý        : ${totalNodesProcessed.toLocaleString('vi-VN')}`)
    console.log(`  flood_predictions  : ${totalPredictions.toLocaleString('vi-VN')} bản ghi`)
    console.log(`  weather_measurements: ${totalWeatherRows.toLocaleString('vi-VN')} bản ghi`)
    console.log(`  Upsert Strategy    : ${PREDICTION_UPSERT_STRATEGY}\n`)

  } catch (err) {
    console.error('[WeatherCron] ❌ Lỗi nghiêm trọng:', err)
  }
}

// ─── Khởi động Cronjob ────────────────────────────────────────────────────────

function startWeatherCron() {
  console.log('[WeatherCron] 📋 Config:')
  console.log(`  • Upsert Strategy : ${PREDICTION_UPSERT_STRATEGY}`)
  console.log(`  • Node Batch Size : ${NODE_BATCH_SIZE}`)
  console.log(`  • AI Timeout      : ${AI_TIMEOUT_MS}ms`)
  
  // "0 */6 * * *" → phút 0 của mỗi 6 tiếng
  cron.schedule('0 */6 * * *', () => {
    console.log('[WeatherCron] Cron trigger tự động...')
    runWeatherCron()
  }, {
    timezone: 'Asia/Ho_Chi_Minh',
  })

  console.log('[WeatherCron] ✅ Đã đăng ký cron schedule: mỗi 6 tiếng (0h/6h/12h/18h ICT).')
  console.log('[WeatherCron] Nguồn dữ liệu: OpenWeatherMap Developer Plan')
}

async function manualTrigger() {
  console.log('[WeatherCron] 🔧 Manual trigger được gọi...')
  await runWeatherCron()
}

module.exports = { startWeatherCron, manualTrigger }
