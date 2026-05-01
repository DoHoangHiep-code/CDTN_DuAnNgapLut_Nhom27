'use strict'

const express = require('express')
const { sequelize }           = require('../db/sequelize')
const { WeatherRepository }   = require('../repositories/WeatherRepository')
const { WeatherService }      = require('../services/WeatherService')
const { WeatherController }   = require('../controllers/WeatherController')
const { getWeatherByCoords, getOWMForecast5d, aggregateToDaily } = require('../services/OpenWeatherService')
const { PredictionService }   = require('../services/PredictionService')
const { FloodPrediction, WeatherMeasurement } = require('../models')
const { Op }                  = require('sequelize')

const router = express.Router()

const weatherRepository = new WeatherRepository({ sequelize })
const weatherService    = new WeatherService({ weatherRepository })
const weatherController = new WeatherController({ weatherService })
const predictionService = new PredictionService({ weatherRepository, sequelize })

// ─── Route cũ: Thời tiết hiện tại từ OWM (delegate lên WeatherController) ────
router.get('/weather', weatherController.getWeather)

// ─── Route: Thời tiết THỰC TẾ từ OpenWeatherMap theo tọa độ ──────────────────
// GET /api/v1/weather/live?lat=21.02&lon=105.83
router.get('/weather/live', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat)
    const lon = Number(req.query.lon)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Tham số lat và lon phải là số thực hợp lệ.' },
      })
    }

    const data = await getWeatherByCoords(lat, lon)

    if (!data) {
      return res.status(503).json({
        success: false,
        error: { message: 'Không thể lấy dữ liệu thời tiết. Kiểm tra OPENWEATHER_API_KEY trong .env.' },
      })
    }

    return res.status(200).json({ success: true, data })
  } catch (err) {
    return next(err)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/weather/forecast7d?lat=21.02&lon=105.83
//
// Dự báo 7 ngày tới (40 data points × 3h từ OWM /data/2.5/forecast + pad).
// Luồng:
//   1. Ưu tiên Cache DB: query flood_predictions + weather_measurements cho
//      node gần nhất. Nếu data mới hơn 6 giờ → trả về ngay (source: 'database').
//   2. Fallback Live OWM: Nếu DB không có data đủ mới → gọi OWM forecast 5d
//      thật → aggregate daily → gọi AI batch → trả về (source: 'live-owm').
//
// Trả về:
//   { success, source, data: Array<{
//     dateIso, minTempC, maxTempC, rainfallMm, humidityPct,
//     flood_depth_cm, risk_level, usingAI
//   }>}
// ─────────────────────────────────────────────────────────────────────────────
router.get('/weather/forecast7d', async (req, res, next) => {
  const HANOI_LAT      = 21.0285
  const HANOI_LON      = 105.8542
  const CACHE_MAX_AGE_H = 6   // Dữ liệu DB cũ hơn 6h mới gọi live OWM

  try {
    const lat = Number.isFinite(Number(req.query.lat)) ? Number(req.query.lat) : HANOI_LAT
    const lon = Number.isFinite(Number(req.query.lon)) ? Number(req.query.lon) : HANOI_LON

    // ── Phase 1: Thử đọc từ DB (Aiven cache bởi Cronjob) ──────────────────
    const cacheThreshold = new Date(Date.now() - CACHE_MAX_AGE_H * 3600 * 1000)

    // Lấy 7 ngày tới từ flood_predictions (DB đã có dữ liệu thật từ Cronjob, có thể tối đa 5 ngày, sẽ pad)
    const today     = new Date().toISOString().slice(0, 10)
    const day7Limit = new Date(Date.now() + 7 * 86400 * 1000).toISOString().slice(0, 10)

    // Tìm node gần nhất trong DB (dùng spatial query đơn giản theo bbox ±0.5°)
    const dbRows = await FloodPrediction.findAll({
      attributes: [
        [sequelize.fn('DATE', sequelize.col('time')), 'date_only'],
        [sequelize.fn('AVG', sequelize.col('flood_depth_cm')), 'avg_depth'],
        [sequelize.fn('MAX', sequelize.col('flood_depth_cm')), 'max_depth'],
        [sequelize.fn('MAX', sequelize.col('risk_level')),     'max_risk'],
        [sequelize.fn('MAX', sequelize.col('updated_at')),     'last_update'],
      ],
      where: {
        time: {
          [Op.gte]: new Date(today + 'T00:00:00Z'),
          [Op.lte]: new Date(day7Limit + 'T23:59:59Z'),
        },
      },
      group: [sequelize.fn('DATE', sequelize.col('time'))],
      order: [[sequelize.fn('DATE', sequelize.col('time')), 'ASC']],
      limit: 7,
      raw: true,
    }).catch(() => [])

    // Kiểm tra cache còn tươi không (ít nhất 1 ngày có last_update > threshold)
    const isCacheValid = dbRows.length >= 3 &&
      dbRows.some(r => r.last_update && new Date(r.last_update) >= cacheThreshold)

    if (isCacheValid) {
      // Lấy thêm weather_measurements để lấy nhiệt độ/độ ẩm từng ngày
      const weatherRows = await WeatherMeasurement.findAll({
        attributes: [
          [sequelize.fn('DATE', sequelize.col('time')), 'date_only'],
          [sequelize.fn('AVG', sequelize.col('temp')),  'avg_temp'],
          [sequelize.fn('MIN', sequelize.col('temp')),  'min_temp'],
          [sequelize.fn('MAX', sequelize.col('temp')),  'max_temp'],
          [sequelize.fn('SUM', sequelize.col('prcp')),  'total_rain'],
          [sequelize.fn('AVG', sequelize.col('rhum')),  'avg_humidity'],
        ],
        where: {
          time: {
            [Op.gte]: new Date(today + 'T00:00:00Z'),
            [Op.lte]: new Date(day7Limit + 'T23:59:59Z'),
          },
        },
        group: [sequelize.fn('DATE', sequelize.col('time'))],
        order: [[sequelize.fn('DATE', sequelize.col('time')), 'ASC']],
        limit: 7,
        raw: true,
      }).catch(() => [])

      // Merge flood + weather theo ngày
      const weatherByDay = new Map(weatherRows.map(r => [r.date_only, r]))

      const RISK_ORDER = { safe: 0, medium: 1, high: 2, severe: 3 }
      let data = dbRows.map(row => {
        const wRow = weatherByDay.get(row.date_only) ?? {}
        const depth = Math.round(Number(row.avg_depth ?? 0) * 10) / 10
        // risk từ avg depth (độ nguy hiểm trung bình, không dùng max để tránh bias)
        const risk = depth < 15 ? 'safe' : depth < 30 ? 'medium' : depth < 60 ? 'high' : 'severe'
        return {
          dateIso:        String(row.date_only).slice(0, 10),
          minTempC:       Math.round(Number(wRow.min_temp ?? 26) * 10) / 10,
          maxTempC:       Math.round(Number(wRow.max_temp ?? 32) * 10) / 10,
          rainfallMm:     Math.round(Number(wRow.total_rain ?? 0) * 10) / 10,
          humidityPct:    Math.round(Number(wRow.avg_humidity ?? 70)),
          flood_depth_cm: depth,
          risk_level:     risk,
          usingAI:        true,
          source:         'database',
        }
      })

      // Pad to 7 days
      while (data.length > 0 && data.length < 7) {
        const last = data[data.length - 1]
        const nextDate = new Date(last.dateIso)
        nextDate.setDate(nextDate.getDate() + 1)
        data.push({
          ...last,
          dateIso: nextDate.toISOString().slice(0, 10),
        })
      }

      return res.status(200).json({
        success: true,
        source:  'database',
        cacheAgeH: Math.round((Date.now() - new Date(dbRows[0]?.last_update ?? 0)) / 3600000),
        data,
      })
    }

    // ── Phase 2: Fallback → gọi OWM Forecast 5d live ─────────────────────────
    console.log('[WeatherRoute/forecast5d] Cache DB miss hoặc quá cũ → gọi OWM live...')
    const owmPoints = await getOWMForecast5d(lat, lon)

    if (!owmPoints || !owmPoints.length) {
      return res.status(503).json({
        success: false,
        error: { message: 'Không thể lấy dự báo thời tiết. OWM không phản hồi và DB cache đã quá cũ.' },
      })
    }

    // Aggregate thành daily
    const dailySummaries = aggregateToDaily(owmPoints, 5)
    const rainyMonths    = [5, 6, 7, 8, 9, 10]

    // Build AI features từ 40 data points OWM cho mỗi ngày
    // Dùng điểm đại diện 12:00 của từng ngày để gọi AI (1 call/ngày = 5 calls)
    const featuresArray = dailySummaries.map((day) => {
      // Lấy data point gần 12h nhất trong ngày
      const noonPoint = day.points.reduce((best, p) => {
        const ict  = new Date(p.timeUtc.getTime() + 7 * 3600 * 1000)
        const diff = Math.abs(ict.getHours() - 12)
        return diff < Math.abs(new Date(best.timeUtc.getTime() + 7 * 3600 * 1000).getHours() - 12) ? p : best
      }, day.points[0])

      const dt        = new Date(noonPoint.timeUtc.getTime() + 7 * 3600 * 1000)
      const hour      = 12
      const month     = dt.getMonth() + 1
      const dayofweek = dt.getDay() === 0 ? 6 : dt.getDay() - 1
      const start     = new Date(dt.getFullYear(), 0, 0)
      const dayofyear = Math.floor((dt - start) / 86400000)

      // Tính prcp windows từ 3h data points của ngày (cộng dồn từng step)
      const prcp     = noonPoint.rain3h
      // Lấy tất cả points trong ngày + ngày trước để tính window
      const allPts   = owmPoints   // full array để tính window
      const noonIdx  = allPts.findIndex(p => p.timeUtc.getTime() === noonPoint.timeUtc.getTime())
      const rain = (stepsBack) => {
        let total = 0
        for (let j = 0; j < stepsBack && noonIdx - j >= 0; j++) {
          total += allPts[noonIdx - j]?.rain3h ?? 0
        }
        return total
      }
      const prcp_3h  = rain(1)   // = prcp (1 step × 3h)
      const prcp_6h  = rain(2)   // 2 steps × 3h
      const prcp_12h = rain(4)   // 4 steps × 3h
      const prcp_24h = rain(8)   // 8 steps × 3h

      return {
        prcp, prcp_3h, prcp_6h, prcp_12h, prcp_24h,
        temp:                noonPoint.temp,
        rhum:                noonPoint.humidity,
        wspd:                noonPoint.windSpeed,   // m/s — đúng đơn vị AI expect
        pres:                noonPoint.pressure,
        pressure_change_24h: 0,
        max_prcp_3h:         prcp_3h,
        max_prcp_6h:         prcp_6h,
        max_prcp_12h:        prcp_12h,
        elevation:           5,    // default Hà Nội trung bình
        slope:               1,
        impervious_ratio:    0.65,
        dist_to_drain_km:    0.4,
        dist_to_river_km:    1.0,
        dist_to_pump_km:     0.8,
        dist_to_main_road_km: 0.2,
        dist_to_park_km:     0.5,
        hour, dayofweek, month, dayofyear,
        hour_sin:  Math.sin((2 * Math.PI * hour) / 24),
        hour_cos:  Math.cos((2 * Math.PI * hour) / 24),
        month_sin: Math.sin((2 * Math.PI * month) / 12),
        month_cos: Math.cos((2 * Math.PI * month) / 12),
        rainy_season_flag: rainyMonths.includes(month) ? 1 : 0,
      }
    })

    // Gọi AI batch
    const aiResults = await predictionService._callAIBatch(featuresArray).catch(() => null)

    // Build response
    let data = dailySummaries.map((day, i) => {
      const rawDepth    = Number(aiResults?.[i]?.flood_depth_cm ?? 0)
      // No-rain override: Nếu tổng mưa ngày = 0 và độ ẩm thấp → depth = 0
      const noRain      = day.rainfallMm === 0 && day.humidityPct < 90
      const finalDepth  = Math.round(Math.max(0, noRain ? 0 : rawDepth) * 10) / 10
      const risk        = finalDepth < 15 ? 'safe' : finalDepth < 30 ? 'medium' : finalDepth < 60 ? 'high' : 'severe'

      return {
        dateIso:        day.dateIso,
        minTempC:       day.minTempC,
        maxTempC:       day.maxTempC,
        rainfallMm:     day.rainfallMm,
        humidityPct:    day.humidityPct,
        flood_depth_cm: finalDepth,
        risk_level:     risk,
        usingAI:        aiResults !== null,
        source:         'live-owm',
      }
    })

    // Pad to 7 days
    while (data.length > 0 && data.length < 7) {
      const last = data[data.length - 1]
      const nextDate = new Date(last.dateIso)
      nextDate.setDate(nextDate.getDate() + 1)
      data.push({
        ...last,
        dateIso: nextDate.toISOString().slice(0, 10),
      })
    }

    return res.status(200).json({
      success: true,
      source:  aiResults ? 'live-owm-ai' : 'live-owm',
      data,
    })
  } catch (err) {
    return next(err)
  }
})

module.exports = { weatherRouter: router }
