const express = require('express')
const { sequelize } = require('../db/sequelize')
const { WeatherRepository } = require('../repositories/WeatherRepository')
const { WeatherService } = require('../services/WeatherService')
const { WeatherController } = require('../controllers/WeatherController')
const { getWeatherByCoords } = require('../services/OpenWeatherService')
const { PredictionService } = require('../services/PredictionService')

const router = express.Router()

const weatherRepository = new WeatherRepository({ sequelize })
const weatherService = new WeatherService({ weatherRepository })
const weatherController = new WeatherController({ weatherService })
const predictionService = new PredictionService({ weatherRepository, sequelize })

// Route cũ: lấy thời tiết từ DB nội bộ theo district/lat/lng
router.get('/weather', weatherController.getWeather)

// Route mới: lấy thời tiết THỰC TẾ từ OpenWeatherMap API theo tọa độ
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
        error: {
          message: 'Không thể lấy dữ liệu thời tiết. Kiểm tra OPENWEATHER_API_KEY trong .env.',
        },
      })
    }

    return res.status(200).json({ success: true, data })
  } catch (err) {
    return next(err)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/weather/forecast7d?lat=21.02&lon=105.83
// Dự báo 7 ngày tới bằng CatBoost: mỗi ngày gọi AI với time-features khác nhau
// + thời tiết OWM hiện tại làm base → trả flood_depth_cm + risk_level mỗi ngày
// ─────────────────────────────────────────────────────────────────────────────
router.get('/weather/forecast7d', async (req, res, next) => {
  try {
    const HANOI_LAT = 21.0285
    const HANOI_LON = 105.8542
    const lat = Number.isFinite(Number(req.query.lat)) ? Number(req.query.lat) : HANOI_LAT
    const lon = Number.isFinite(Number(req.query.lon)) ? Number(req.query.lon) : HANOI_LON

    // Lấy thời tiết hiện tại từ OWM làm base features
    const owm = await getWeatherByCoords(lat, lon).catch(() => null)

    const rainyMonths = [5, 6, 7, 8, 9, 10]
    const now = new Date()

    // Build features cho từng ngày trong 7 ngày tới
    const featuresArray = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now.getTime() + (i + 1) * 86400 * 1000)
      const hour = 12 // Dùng 12h trưa làm đại diện mỗi ngày
      const month = day.getMonth() + 1
      const dayofweek = day.getDay() === 0 ? 6 : day.getDay() - 1
      const start = new Date(day.getFullYear(), 0, 0)
      const dayofyear = Math.floor((day - start) / 86400000)

      // Lượng mưa: nếu có OWM thật thì dùng, tăng nhẹ theo ngày (mô phỏng xu hướng)
      const basePrcp = owm?.rain1h ?? 0
      const prcp = Math.max(0, basePrcp + Math.sin(i * 0.8) * 1.5)

      return {
        prcp,
        prcp_3h:  prcp * 2.5,
        prcp_6h:  prcp * 4,
        prcp_12h: prcp * 6,
        prcp_24h: prcp * 8,
        temp:     owm?.temp ?? 28,
        rhum:     owm?.humidity ?? 70,
        wspd:     owm?.windSpeed ?? 0,
        pres:     owm?.pressure ?? 1010,
        pressure_change_24h: 0,
        max_prcp_3h:  prcp,
        max_prcp_6h:  prcp,
        max_prcp_12h: prcp,
        elevation: 5, slope: 1, impervious_ratio: 0.65,
        dist_to_drain_km: 0.4, dist_to_river_km: 1.0,
        dist_to_pump_km: 0.8, dist_to_main_road_km: 0.2, dist_to_park_km: 0.5,
        hour, dayofweek, month, dayofyear,
        hour_sin:  Math.sin((2 * Math.PI * hour) / 24),
        hour_cos:  Math.cos((2 * Math.PI * hour) / 24),
        month_sin: Math.sin((2 * Math.PI * month) / 12),
        month_cos: Math.cos((2 * Math.PI * month) / 12),
        rainy_season_flag: rainyMonths.includes(month) ? 1 : 0,
      }
    })

    // Gọi AI batch
    const aiResults = await predictionService._callAIBatch(featuresArray)

    const days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now.getTime() + (i + 1) * 86400 * 1000)
      const depth = Number(aiResults?.[i]?.flood_depth_cm ?? 0)

      // no-rain override: OWM xác nhận không mưa + độ ẩm thấp → depth = 0
      const noRain = owm !== null && (owm.rain1h ?? 0) === 0 && (owm.humidity ?? 100) < 90
      const finalDepth = noRain ? 0 : Math.max(0, depth)

      const risk = finalDepth < 15 ? 'safe'
        : finalDepth < 30 ? 'medium'
        : finalDepth < 60 ? 'high' : 'severe'

      // Nhiệt độ min/max dựa trên OWM hiện tại + offset theo ngày
      const baseTemp = owm?.temp ?? 28
      return {
        dateIso:       day.toISOString().slice(0, 10),
        minTempC:      Math.round((baseTemp - 3 + i * 0.2) * 10) / 10,
        maxTempC:      Math.round((baseTemp + 4 + i * 0.2) * 10) / 10,
        rainfallMm:    Math.round(featuresArray[i].prcp * 24 * 10) / 10, // tích lũy 24h ước tính
        humidityPct:   Math.min(95, (owm?.humidity ?? 70) + i * 2),
        flood_depth_cm: Math.round(finalDepth * 10) / 10,
        risk_level:    risk,
        usingAI:       aiResults !== null,
      }
    })

    return res.status(200).json({
      success: true,
      source: aiResults ? 'catboost' : 'estimated',
      usingLiveWeather: owm !== null,
      data: days,
    })
  } catch (err) {
    return next(err)
  }
})

module.exports = { weatherRouter: router }

