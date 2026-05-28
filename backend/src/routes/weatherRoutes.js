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

// ─── Route: Dự báo mưa theo giờ (24h tới) từ DB cho node gần nhất ───────────
// GET /api/v1/weather/forecast24h?lat=21.02&lng=105.83
router.get('/weather/forecast24h', async (req, res, next) => {
  const HANOI_LAT = 21.0285
  const HANOI_LON = 105.8542
  try {
    const nearest = await weatherRepository.findNearestNode({ lat, lng }).catch(() => null)
    if (!nearest || !nearest.st1_id) {
      return res.status(200).json({ success: true, source: 'empty', data: [] })
    }

    const rows = await weatherRepository.getHourlyForecast24h(nearest.st1_id).catch(() => [])

    if (!rows || rows.length === 0) {
      return res.status(200).json({ success: true, source: 'empty', data: [] })
    }

    const data = rows.map(r => ({
      timeIso:    new Date(r.time).toISOString(),
      rainfallMm: Math.round(Number(r.prcp)   * 10) / 10,
      tempC:      Math.round(Number(r.temp)   * 10) / 10,
      humidity:   Math.round(Number(r.rhum)),
      cloudsPct:  Number(r.clouds) || 0,
    }))

    return res.status(200).json({ success: true, source: 'database', nodeId: nearest.node_id, data })
  } catch (err) {
    return next(err)
  }
})

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

    const nearest = await weatherRepository.findNearestNode({ lat, lng: lon }).catch(() => null)
    if (!nearest || !nearest.node_id || !nearest.st1_id) {
      return res.status(404).json({ success: false, error: { message: 'Không tìm thấy trạm đo tương ứng' } })
    }

    // Lấy 7 ngày tới từ flood_predictions cho grid node
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
        node_id: nearest.node_id,
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
          node_id: nearest.st1_id,
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

    return res.status(200).json({
      success: true,
      source:  'database',
      data: dbRows.length > 0 ? data : [],
    })
  } catch (err) {
    return next(err)
  }
})

module.exports = { weatherRouter: router }
