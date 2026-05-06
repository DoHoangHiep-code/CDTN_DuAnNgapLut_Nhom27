'use strict'

// weatherCron.js – Cronjob tự động dự báo ngập lụt mỗi 1 tiếng
//
// Nguồn dữ liệu thời tiết (DUY NHẤT): OpenWeatherMap Developer Plan
//   • Current weather    : GET /data/2.5/weather              (101 calls/lần – 101 trạm)
//   • Hourly 4d Forecast : GET pro.openweathermap.org/data/2.5/forecast/hourly
//                           (96 điểm × 1h = 4 ngày, 101 calls/lần)
//   • Fallback           : GET /data/2.5/forecast (5d/3h) nếu key chưa kích hoạt Developer
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

const { WeatherStation } = require('../models')

const cron       = require('node-cron')
const axiosRetry = require('axios-retry').default || require('axios-retry')
const axios      = require('axios')
const http       = require('http')
const https      = require('https')

const axiosKeepAlive = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 1 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 1 }),
})
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) =>
    error.code === 'ECONNABORTED' || axiosRetry.isNetworkOrIdempotentRequestError(error),
})

const { getWeatherByCoords, getOWMForecast5d, getOWMHourlyForecast4d } = require('./OpenWeatherService')
const { GridNode, FloodPrediction, WeatherMeasurement, SystemLog } = require('../models')
const { sequelize } = require('../db/sequelize')

// ─── Cấu hình ────────────────────────────────────────────────────────────────

const AI_SERVICE_URL  = process.env.AI_SERVICE_URL || 'http://localhost:8000'
const AI_TIMEOUT_MS   = 300000  // 5 phút
const AI_BATCH_SIZE   = 500     // Giảm xuống 500 để tránh FastAPI 400 (Pydantic parse timeout)
const STATION_CONCURRENCY = 1   // CHỈ CHẠY 1 TRẠM TẠI 1 THỜI ĐIỂM ĐỂ TRÁNH TRÀN RAM

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

  const stations = await WeatherStation.findAll({ raw: true })
  console.log(`[WeatherCron/OWM] Fetch current weather cho ${stations.length} trạm...`)
  const stationWeatherMap = new Map()

  await Promise.allSettled(
    stations.map(async (station) => {
      const w = await getWeatherByCoords(station.latitude, station.longitude)
      if (w) {
        stationWeatherMap.set(station.id, w)
        console.log(`  [Trạm ${station.id}] ✅ ${station.name} — temp=${w.temp}°C rain=${w.rain1h}mm`)
      } else {
        console.warn(`  [Trạm ${station.id}] ⚠️  ${station.name} — OWM thất bại`)
      }
    })
  )
  console.log(`[WeatherCron/OWM] Lấy được ${stationWeatherMap.size}/${stations.length} trạm.\n`)

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
      // Lưu clouds để BI/AI có thể phân tích tương quan mây che - mưa - ngập
      clouds:        Number(w.clouds)    || 0,
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
        'clouds', 'wspd', 'wdir', 'pres', 'date_only', 'month', 'hour', 'rainy_season_flag',
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
    const res = await axiosKeepAlive.post(
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
 * @param {Array}   owmPoints      – output của getOWMForecast5d() cho trạm đó
 * @param {Map}     presHistoryMap – Map(timestampMs => pressure) lịch sử 48h của trạm
 * @returns {Promise<{predictionRecords: Array, weatherRecords: Array}>}
 */
async function processNodeWithOWMForecast(node, owmPoints, presHistoryMap) {
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
    const clouds = p.clouds          // % mây che
    const wdir = p.windDeg
    const visibility_km = p.visibility != null ? (p.visibility / 1000) : null

    // Tìm áp suất 24h trước (24h = 86400000ms)
    const time24hAgo = p.timeUtc.getTime() - 86400000
    let pres24hAgo = null
    
    // Thử tìm trong owmPoints (nếu điểm này ở tương lai > 24h)
    const pastPointInOwm = owmPoints.find(op => op.timeUtc.getTime() === time24hAgo)
    if (pastPointInOwm) {
      pres24hAgo = pastPointInOwm.pressure
    } else if (presHistoryMap) {
      // Tìm trong lịch sử DB (với sai số cho phép +- 1 giờ vì cronjob chạy có thể trễ vài phút)
      for (const [tMs, pastP] of presHistoryMap.entries()) {
         if (Math.abs(tMs - time24hAgo) <= 3600000) {
            pres24hAgo = pastP
            break
         }
      }
    }
    const pressure_change_24h = pres24hAgo ? Number((pres - pres24hAgo).toFixed(2)) : 0

    // Tính prcp windows từ sliding window trên mảng hourly (1h/step)
    // Mỗi step = 1h → prcp_3h = 3 step, prcp_6h = 6 step, prcp_12h = 12 step, prcp_24h = 24 step
    // (Nếu dùng fallback 3h/step: prcp_3h = 1 step, prcp_6h = 2, prcp_12h = 4, prcp_24h = 8)
    const stepSizeH = owmPoints.length >= 48 ? 1 : 3  // auto-detect hourly vs 3h forecast
    const rain = (targetHours) => {
      const steps = Math.ceil(targetHours / stepSizeH)
      let total = 0
      for (let j = 0; j < steps && i - j >= 0; j++) {
        total += owmPoints[i - j]?.rain3h ?? 0
      }
      return total
    }
    const prcp_3h  = rain(3)
    const prcp_6h  = rain(6)
    const prcp_12h = rain(12)
    const prcp_24h = rain(24)

    featuresArray.push({
      prcp, prcp_3h, prcp_6h, prcp_12h, prcp_24h,
      temp, rhum, wspd, pres,
      pressure_change_24h,
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
      clouds,
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
  // (Hàm processNodeWithOWMForecast không còn gọi AI trực tiếp nữa — logic chuyển sang processStationNodes)
  return { predictionRecords: [], weatherRecords }
}

// ─── Pre-compute shared weather features cho 96h (dùng chung cho mọi node trong trạm) ─

/**
 * Tính sẵn mảng shared weather features cho toàn bộ owmPoints của 1 trạm.
 * Kết quả này dùng chung cho tất cả nodes trong trạm — tránh tính lại 53.000 lần.
 */
function buildSharedWeatherFeatures(owmPoints, presHistoryMap) {
  const rainyMonths = [5, 6, 7, 8, 9, 10]
  const stepSizeH   = owmPoints.length >= 48 ? 1 : 3

  return owmPoints.map((p, i) => {
    const ictMs = p.timeUtc.getTime() + 7 * 3600 * 1000
    const dt    = new Date(ictMs)
    const hour      = dt.getHours()
    const month     = dt.getMonth() + 1
    const dayofweek = dt.getDay() === 0 ? 6 : dt.getDay() - 1
    const start     = new Date(dt.getFullYear(), 0, 0)
    const dayofyear = Math.floor((dt - start) / 86400000)
    const date_only = dt.toISOString().slice(0, 10)
    const rainy_season_flag = rainyMonths.includes(month)

    const pres      = p.pressure
    const temp      = p.temp
    const rhum      = p.humidity
    const prcp      = p.rain3h
    const wspd      = p.windSpeed
    const clouds    = p.clouds
    const wdir      = p.windDeg
    const visibility_km = p.visibility != null ? (p.visibility / 1000) : null
    const feels_like_c  = p.feels_like

    // Pressure change 24h
    const time24hAgo = p.timeUtc.getTime() - 86400000
    let pres24hAgo = null
    const pastInOwm = owmPoints.find(op => op.timeUtc.getTime() === time24hAgo)
    if (pastInOwm) {
      pres24hAgo = pastInOwm.pressure
    } else if (presHistoryMap) {
      for (const [tMs, pastP] of presHistoryMap.entries()) {
        if (Math.abs(tMs - time24hAgo) <= 3600000) { pres24hAgo = pastP; break }
      }
    }
    const pressure_change_24h = pres24hAgo ? Number((pres - pres24hAgo).toFixed(2)) : 0

    // Sliding window rain
    const rain = (targetHours) => {
      const steps = Math.ceil(targetHours / stepSizeH)
      let total = 0
      for (let j = 0; j < steps && i - j >= 0; j++) total += owmPoints[i - j]?.rain3h ?? 0
      return total
    }
    const prcp_3h  = rain(3)
    const prcp_6h  = rain(6)
    const prcp_12h = rain(12)
    const prcp_24h = rain(24)

    return {
      // features gửi cho AI (thay đổi theo node: elevation/slope/impervious_ratio sẽ merge vào sau)
      weatherBase: { prcp, prcp_3h, prcp_6h, prcp_12h, prcp_24h, temp, rhum, wspd, pres,
        pressure_change_24h, max_prcp_3h: prcp_3h, max_prcp_6h: prcp_6h, max_prcp_12h: prcp_12h,
        dist_to_drain_km: 0.5, dist_to_river_km: 1.0, dist_to_pump_km: 1.0,
        dist_to_main_road_km: 0.3, dist_to_park_km: 0.5,
        hour, dayofweek, month, dayofyear,
        hour_sin:  Math.sin((2 * Math.PI * hour)  / 24),
        hour_cos:  Math.cos((2 * Math.PI * hour)  / 24),
        month_sin: Math.sin((2 * Math.PI * month) / 12),
        month_cos: Math.cos((2 * Math.PI * month) / 12),
        rainy_season_flag: rainy_season_flag ? 1 : 0,
      },
      // metadata để map kết quả AI về DB
      meta: {
        timeUtc: p.timeUtc, date_only, month, hour, rainy_season_flag,
        prcp, temp, clouds, wdir, pres, rhum, wspd, prcp_3h, prcp_6h, prcp_12h, prcp_24h,
        pressure_change_24h, visibility_km, feels_like_c,
      },
    }
  })
}

/**
 * Xử lý toàn bộ nodes của 1 trạm bằng cách:
 *   1. Dùng sharedFeatures (đã tính sẵn) cho 96h
 *   2. Merge với static features (elevation/slope/impervious_ratio) của từng node
 *   3. Gửi 1 mega-batch duy nhất lên FastAPI (thường N_nodes × 96h features)
 *   4. Map kết quả AI về đúng node_id + timestamp
 */
async function processStationNodes(stationNodes, sharedFeatures, stationName) {
  const allPredRecords = []

  // Mega feature matrix
  const megaFeatures = []
  const megaMeta     = []

  for (const node of stationNodes) {
    const elev = Number(node.elevation)        || 5
    const slp  = Number(node.slope)            || 1
    const imp  = Number(node.impervious_ratio) || 0.5
    for (const sf of sharedFeatures) {
      megaFeatures.push({ ...sf.weatherBase, elevation: elev, slope: slp, impervious_ratio: imp })
      megaMeta.push({ node_id: node.node_id, ...sf.meta })
    }
  }

  if (!megaFeatures.length) return { predictionRecords: [] }

  // Gọi AI tuần tự để tránh numpy._ArrayMemoryError
  const aiResults = []
  for (let i = 0; i < megaFeatures.length; i += AI_BATCH_SIZE) {
    const chunk = megaFeatures.slice(i, i + AI_BATCH_SIZE)
    const res   = await callAIPredictBatch(chunk)
    if (res) {
      for (const item of res) aiResults.push(item)
    } else {
      for (let k = 0; k < chunk.length; k++) aiResults.push(null)
    }
  }

  // Map kết quả AI → lean predictionRecords (chỉ 4 trường cần thiết)
  for (let idx = 0; idx < aiResults.length; idx++) {
    const result = aiResults[idx]
    const meta   = megaMeta[idx]
    if (!meta || !result || result.flood_depth_cm == null) continue
    const depthCm   = Number(result.flood_depth_cm)
    const riskLevel = calcRiskLevel(depthCm)
    allPredRecords.push({
      node_id:        meta.node_id,
      time:           meta.timeUtc,
      flood_depth_cm: depthCm,
      target:         depthCm > 10 ? 1 : 0,
      risk_level:     riskLevel,
      explanation:    buildExplanation({ riskLevel, depthCm, prcp: meta.prcp, temp: meta.temp }),
      date_only:      meta.date_only,
      month:          meta.month,
      hour:           meta.hour,
      rainy_season_flag: meta.rainy_season_flag,
    })
  }

  return { predictionRecords: allPredRecords }
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
        'clouds', 'wspd', 'wdir', 'pres', 'date_only',
        'visibility_km', 'feels_like_c',
        'month', 'hour', 'rainy_season_flag', 'location_name',
      ],
      logging: false,
      returning: false,
      hooks: false
    })
    total += Math.min(BATCH_SIZE, records.length - i)
  }
  console.log(`[WeatherCron] ✅ Đã cập nhật ${total.toLocaleString('vi-VN')} dòng weather_measurements.`)
}

// ─── Upsert flood_predictions ─────────────────────────────────────────────────

async function upsertPredictions(records) {
  if (!records.length) return
  const BATCH_SIZE = 12000  // ~12k rows/lô để tối ưu throughput CockroachDB
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    await FloodPrediction.bulkCreate(records.slice(i, i + BATCH_SIZE), {
      conflictAttributes: ['node_id', 'time'],
      updateOnDuplicate: [
        'flood_depth_cm', 'target', 'risk_level', 'explanation',
        'date_only', 'month', 'hour', 'rainy_season_flag',
      ],
      logging: false,
      returning: false,
      hooks: false,
    })
  }
  console.log(`[WeatherCron] ✅ Upsert ${records.length.toLocaleString('vi-VN')} flood_predictions (${new Date().toISOString()}).`)
}

// ─── Hàm chính: runWeatherCron ────────────────────────────────────────────────

/**
 * Kiến trúc "Trạm Đại Diện" (Station Clustering) với nguồn dữ liệu OWM:
 *
 *  Phase 0 – OWM Current (8 calls): Lấy thời tiết hiện tại → fan-out weather_measurements
 *  Phase 1 – OWM Forecast 5d (8 calls): Lấy 40 data points × 3h cho 8 trạm
 *  Phase 2 – AI Inference: Mỗi node trong cụm dùng forecast của trạm → gọi AI batch
 *  Phase 3 – Upsert: flood_predictions + weather_measurements lên CockroachDB
 *
 * Tổng API calls: 8 (current) + 8 (forecast) = 16 calls/lần chạy
 */
async function runWeatherCron() {
  const startTime = Date.now()
  console.log(`\n[WeatherCron] ⏰ Bắt đầu lúc ${new Date().toISOString()} (OWM Station-based)`)
  const stations = await WeatherStation.findAll({ raw: true })
  console.log(`[WeatherCron] Số trạm đại diện: ${stations.length}`)
  console.log(`[WeatherCron] Nguồn dữ liệu: OpenWeatherMap /data/2.5/forecast (5d/3h)`)

  // ── Lưu ý: KHÔNG Truncate. Dữ liệu lịch sử được bảo toàn. ────────────────────
  // Toàn bộ việc ghi DB dùng INSERT ... ON CONFLICT DO UPDATE (UPSERT) để cập nhật
  // các bản ghi trùng key thay vì xóa toàn bộ bảng mỗi lần chạy cron.
  // Data retention (xóa data cũ >30 ngày) được xử lý riêng bởi backupCron.js.

  try {
    // ── Phase 0: Ingest current weather từ OWM ───────────────────────────────
    const owmRows = await ingestCurrentWeatherFromOWM()
    console.log(`[WeatherCron/OWM] Fan-out xong: ${owmRows.toLocaleString('vi-VN')} bản ghi.\n`)

    // ── Phase 1: Fetch OWM Hourly 4d (96h) cho các trạm song song ──────────────
    console.log(`\n[Phase 1] Fetch OWM Hourly Forecast 4d (96h) cho ${stations.length} trạm...`)
    const stationForecasts = new Map()   // stationId → owmPoints[]

    // Chia mảng station ra thành các chunk để fetch dần dần (mỗi lần 10-15 trạm),
    // giúp tránh tình trạng bị server chối từ kết nối (Too Many Requests / Connection Reset)
    const MAX_CONCURRENT_REQUESTS = 10
    let fetchedStations = 0
    
    for (let chunkStart = 0; chunkStart < stations.length; chunkStart += MAX_CONCURRENT_REQUESTS) {
      const chunk = stations.slice(chunkStart, chunkStart + MAX_CONCURRENT_REQUESTS)
      await Promise.allSettled(
        chunk.map(async (station) => {
          const points = await getOWMHourlyForecast4d(station.latitude, station.longitude)
          if (points && points.length) {
            stationForecasts.set(station.id, points)
            console.log(`  [Trạm ${station.id}] ✅ ${station.name} — ${points.length} điểm (${points.length}h)`)
          } else {
            console.warn(`  [Trạm ${station.id}] ⚠️  ${station.name} — fetch thất bại`)
          }
        })
      )
      fetchedStations += chunk.length
      // Tạm nghỉ 1s giữa các đợt gọi API OWM để tránh bị cấm do rate limit.
      if (fetchedStations < stations.length) {
         await new Promise(r => setTimeout(r, 1000))
      }
    }
    
    console.log(`[Phase 1] ✅ Lấy được ${stationForecasts.size}/${stations.length} trạm. (96h/trạm)\n`)


    // ── Phase 2: Xử lý các trạm SONG SONG (chunk STATION_CONCURRENCY trạm một lúc) ────────
    console.log(`[Phase 2] Xử lý ${stations.length} trạm (${STATION_CONCURRENCY} trạm song song)...`)

    const allPredictions    = []
    let totalPredictions    = 0
    let totalNodesProcessed = 0

    // Pre-fetch nodes TRƯỚC để có valid node_id cho weather_measurements

    // Pre-fetch tất cả nodes và presHistory trong 1 query to trước vòng lặp
    const allStationIds   = stations.map(s => s.id)
    const [presHistoryRows] = await sequelize.query(`
      SELECT DISTINCT ON (node_id) node_id, pres, time
      FROM weather_measurements
      WHERE node_id = ANY(:ids) AND time >= NOW() - INTERVAL '48 hours'
      ORDER BY node_id, time DESC
    `, { replacements: { ids: allStationIds } })

    // Map stationId → presHistoryMap
    const stationPresMap = new Map()
    for (const r of presHistoryRows) {
      const sid = Number(r.node_id)
      if (!stationPresMap.has(sid)) stationPresMap.set(sid, new Map())
      stationPresMap.get(sid).set(new Date(r.time).getTime(), Number(r.pres))
    }

    // Pre-fetch tất cả nodes 1 lần
    const [allNodeRows] = await sequelize.query(`
      SELECT node_id, latitude, longitude, elevation, slope, impervious_ratio,
             location_name, weather_station_id
      FROM grid_nodes
      WHERE weather_station_id = ANY(:ids)
    `, { replacements: { ids: allStationIds } })

    // Group nodes by station_id
    const nodesByStation = new Map()
    for (const n of allNodeRows) {
      const sid = Number(n.weather_station_id)
      if (!nodesByStation.has(sid)) nodesByStation.set(sid, [])
      nodesByStation.get(sid).push(n)
    }
    console.log(`[Phase 2] Đã load ${allNodeRows.length.toLocaleString('vi-VN')} nodes và ${presHistoryRows.length} pressure records.`)

    // ── Phase 1.5: Ghi weather_measurements (101 trạm × 96h = 9.696 records) ────────
    // Dùng node_id của node đầu tiên trong cluster (valid FK vào grid_nodes)
    console.log(`\n[Phase 1.5] Ghi weather_measurements (station-level, mỗi trạm 1 node × 96h)...`)
    const rainyMonths = [5, 6, 7, 8, 9, 10]
    const stationWeatherRecords = []
    for (const station of stations) {
      const owmPts = stationForecasts.get(station.id)
      if (!owmPts) continue
      const clusterNodes = nodesByStation.get(Number(station.id))
      if (!clusterNodes || !clusterNodes.length) continue
      // Dùng node đầu tiên của cluster làm representative (node_id hợp lệ với FK)
      const repNodeId = clusterNodes[0].node_id
      for (const p of owmPts) {
        const ictMs  = p.timeUtc.getTime() + 7 * 3600 * 1000
        const dt     = new Date(ictMs)
        const month  = dt.getMonth() + 1
        const hour   = dt.getHours()
        const date_only = dt.toISOString().slice(0, 10)
        stationWeatherRecords.push({
          node_id:             repNodeId,
          time:                p.timeUtc,
          date_only, month, hour,
          rainy_season_flag:   rainyMonths.includes(month),
          location_name:       station.name,
          temp:                p.temp,
          rhum:                p.humidity,
          clouds:              p.clouds,
          prcp:                p.rain3h,
          prcp_3h:             p.rain3h,
          prcp_6h:             p.rain3h,
          prcp_12h:            p.rain3h,
          prcp_24h:            p.rain3h,
          wspd:                p.windSpeed,
          wdir:                p.windDeg,
          pres:                p.pressure,
          pressure_change_24h: 0,
          max_prcp_3h:         p.rain3h,
          max_prcp_6h:         p.rain3h,
          max_prcp_12h:        p.rain3h,
          visibility_km:       p.visibility != null ? p.visibility / 1000 : null,
          feels_like_c:        p.feels_like,
        })
      }
    }
    await upsertWeatherMeasurements(stationWeatherRecords)
    console.log(`[Phase 1.5] ✅ Đã ghi ${stationWeatherRecords.length.toLocaleString('vi-VN')} weather_measurements.\n`)

    // Xử lý theo STATION_CONCURRENCY=1 trạm mỗi lần để tránh OOM
    for (let si = 0; si < stations.length; si += STATION_CONCURRENCY) {
      const stationChunk = stations.slice(si, si + STATION_CONCURRENCY)
        .filter(s => stationForecasts.has(s.id))

      const chunkResults = await Promise.allSettled(
        stationChunk.map(async (station) => {
          const owmPoints    = stationForecasts.get(station.id)
          const stationNodes = nodesByStation.get(Number(station.id)) ?? []
          if (!stationNodes.length) return { predictionRecords: [] }

          const presHistoryMap = stationPresMap.get(Number(station.id)) ?? new Map()
          const sharedFeatures = buildSharedWeatherFeatures(owmPoints, presHistoryMap)

          const result = await processStationNodes(stationNodes, sharedFeatures, station.name)
          console.log(`  [Trạm ${station.name}] ✅ ${stationNodes.length} nodes × ${owmPoints.length}h = ${result.predictionRecords.length} pred`)
          totalNodesProcessed += stationNodes.length
          return result
        })
      )

      for (const r of chunkResults) {
        if (r.status === 'fulfilled' && r.value) {
          for (const rec of r.value.predictionRecords) allPredictions.push(rec)
        }
      }

      const doneStations = Math.min(si + STATION_CONCURRENCY, stations.length)
      console.log(`[Phase 2] Tiến độ: ${doneStations}/${stations.length} trạm | Predictions: ${allPredictions.length.toLocaleString('vi-VN')}`)

      // Flush predictions mỗi 200k records, chỉ flush predictions (KHÔNG weather)
      if (allPredictions.length >= 200000 || doneStations === stations.length) {
        if (allPredictions.length) {
          console.log(`  [Flush] Đang ghi ${allPredictions.length.toLocaleString('vi-VN')} flood_predictions...`)
          await upsertPredictions(allPredictions)
            .catch(e => console.error('[DB Flush Error]', e.message))
          totalPredictions += allPredictions.length
          allPredictions.length = 0
        }
      }
    }

    // Phase 3: phần còn lại đã được flush trong vòng lặp Phase 2

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n[WeatherCron] 🏁 Hoàn thành sau ${elapsed}s`)
    console.log(`  Trạm fetch OK      : ${stationForecasts.size}/${stations.length}`)
    console.log(`  Nodes xử lý        : ${totalNodesProcessed.toLocaleString('vi-VN')}`)
    console.log(`  flood_predictions  : ${totalPredictions.toLocaleString('vi-VN')} bản ghi`)
    console.log(`  weather_measurements: ${stationWeatherRecords.length.toLocaleString('vi-VN')} bản ghi (station-level, không nhân nodes)\n`)
    try {
      await SystemLog.create({
        admin_id:     null,
        event_type:   'CRONJOB_WEATHER',
        event_source: 'services/weatherCron (OWM station-based)',
        message:      `Cronjob OK: stations=${stationForecasts.size}, nodes=${totalNodesProcessed}, predictions=${totalPredictions}, weather=${stationWeatherRecords.length}, elapsed=${elapsed}s`,
        timestamp:    new Date(),
      })
    } catch (logErr) {
      console.warn('[WeatherCron] Không ghi được SystemLog:', logErr.message)
    }

  } catch (err) {
    console.error('[WeatherCron] ❌ Lỗi nghiêm trọng:', err)
  }
}

// ─── Cleanup: Xoá data cũ hơn 7 ngày (Rolling Retention) ─────────────────────

async function runDataCleanup() {
  console.log('[Cleanup] 🧹 Bắt đầu dọn dẹp dữ liệu cũ hơn 7 ngày...')
  try {
    const [predResult] = await sequelize.query(`
      DELETE FROM flood_predictions WHERE time < NOW() - INTERVAL '7 days'
    `)
    const [wxResult] = await sequelize.query(`
      DELETE FROM weather_measurements WHERE time < NOW() - INTERVAL '7 days'
    `)
    const predDel = predResult?.rowCount ?? 0
    const wxDel   = wxResult?.rowCount   ?? 0
    console.log(`[Cleanup] ✅ Đã xóa ${predDel.toLocaleString('vi-VN')} flood_predictions cũ`)
    console.log(`[Cleanup] ✅ Đã xóa ${wxDel.toLocaleString('vi-VN')} weather_measurements cũ`)

    try {
      await SystemLog.create({
        admin_id:     null,
        event_type:   'CLEANUP_7DAY',
        event_source: 'services/weatherCron',
        message:      `Cleanup: xóa ${predDel} flood_predictions + ${wxDel} weather_measurements cũ > 7 ngày`,
        timestamp:    new Date(),
      })
    } catch (_) {}
  } catch (err) {
    console.error('[Cleanup] ❌ Lỗi khi dọn dẹp:', err.message)
  }
}

// ─── Khởi động Cronjob ────────────────────────────────────────────────────────

function startWeatherCron() {
  // Dự báo chính: mỗi 1 tiếng
  cron.schedule('0 * * * *', () => {
    console.log('[WeatherCron] ⏰ Cron trigger tự động (1h)...')
    runWeatherCron()
  }, {
    timezone: 'Asia/Ho_Chi_Minh',
  })

  // Dọn dẹp 7 ngày: chạy lúc 01:00 AM mỗi ngày
  cron.schedule('0 1 * * *', () => {
    console.log('[WeatherCron] 🧹 Daily cleanup trigger...')
    runDataCleanup()
  }, {
    timezone: 'Asia/Ho_Chi_Minh',
  })

  console.log('[WeatherCron] ✅ Đã đăng ký cron schedules:')
  console.log('   • Dự báo chính  : "0 * * * *" — mỗi 1 tiếng (ICT)')
  console.log('   • Cleanup 7 ngày: "0 1 * * *"  — 01:00 AM hàng ngày (ICT)')
  console.log('[WeatherCron] Nguồn dữ liệu: OpenWeatherMap Developer Plan (Hourly 4d/96h)')
}

async function manualTrigger() {
  console.log('[WeatherCron] 🔧 Manual trigger được gọi...')
  await runWeatherCron()
}

async function manualCleanup() {
  console.log('[WeatherCron] 🧹 Manual cleanup được gọi...')
  await runDataCleanup()
}

module.exports = { startWeatherCron, manualTrigger, manualCleanup }
