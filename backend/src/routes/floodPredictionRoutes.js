'use strict'

const express = require('express')
const { sequelize } = require('../db/sequelize')
const { WeatherRepository } = require('../repositories/WeatherRepository')
const { PredictionService } = require('../services/PredictionService')
const { FloodPredictionController } = require('../controllers/FloodPredictionController')
const { getWeatherByCoords } = require('../services/OpenWeatherService')
const { depthCmToWarning } = require('../utils/labelMapping')

const router = express.Router()

const weatherRepository = new WeatherRepository({ sequelize })
const predictionService = new PredictionService({ weatherRepository, sequelize })
// sequelize inject: controller cần để chạy raw BBox query trực tiếp
const controller = new FloodPredictionController({ predictionService, sequelize })

// Route hiện có: batch prediction toàn bộ nodes
router.get('/flood-prediction', controller.getFloodPrediction)
router.post('/flood-prediction/run', controller.triggerBatch)

// Route mới: dự đoán theo tọa độ cụ thể (dùng cho FloodWarningCard)
// GET /api/v1/flood-prediction/by-location?lat=21.02&lon=105.83
router.get('/flood-prediction/by-location', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat)
    const lon = Number(req.query.lon)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Tham số lat và lon phải là số thực hợp lệ.' },
      })
    }

    // Bước 1: Lấy thời tiết thực tế từ OpenWeatherMap
    const weatherData = await getWeatherByCoords(lat, lon)

    // Bước 2: Build features đủ để gọi model AI
    // Nếu OWM không khả dụng, dùng fallback rỗng (model vẫn chạy với giá trị default)
    const now = new Date()
    const hour = now.getHours()
    const month = now.getMonth() + 1
    const dayofweek = now.getDay() === 0 ? 6 : now.getDay() - 1
    const start = new Date(now.getFullYear(), 0, 0)
    const dayofyear = Math.floor((now - start) / 86400000)
    const rainyMonths = [5, 6, 7, 8, 9, 10]

    // Lượng mưa hiện tại từ OWM (rain1h, mm), fallback 0
    const prcp = weatherData?.rain1h ?? 0

    const features = {
      prcp,
      prcp_3h:            prcp * 2.5,   // ước tính tích lũy 3h
      prcp_6h:            prcp * 4,     // ước tính tích lũy 6h
      prcp_12h:           prcp * 6,     // ước tính tích lũy 12h
      prcp_24h:           prcp * 8,     // ước tính tích lũy 24h
      temp:               weatherData?.temp ?? 28,
      rhum:               weatherData?.humidity ?? 70,
      // FIX: OWM trả windSpeed theo m/s, model CatBoost cũng expect m/s – KHÔNG nhân 3.6
      wspd:               weatherData?.windSpeed ?? 0,
      pres:               weatherData?.pressure ?? 1010,
      pressure_change_24h: 0,
      max_prcp_3h:        prcp,
      max_prcp_6h:        prcp,
      max_prcp_12h:       prcp,
      // Giá trị địa lý trung bình cho vùng Hà Nội (node đại diện)
      elevation:          5,
      slope:              1,
      impervious_ratio:   0.65,
      dist_to_drain_km:   0.4,
      dist_to_river_km:   1.0,
      dist_to_pump_km:    0.8,
      dist_to_main_road_km: 0.2,
      dist_to_park_km:    0.5,
      // Time features
      hour,
      dayofweek,
      month,
      dayofyear,
      hour_sin:  Math.sin((2 * Math.PI * hour) / 24),
      hour_cos:  Math.cos((2 * Math.PI * hour) / 24),
      month_sin: Math.sin((2 * Math.PI * month) / 12),
      month_cos: Math.cos((2 * Math.PI * month) / 12),
      rainy_season_flag: rainyMonths.includes(month) ? 1 : 0,
    }

    // Bước 3: Gọi AI service
    const aiResult = await predictionService._callAI(features)

    // Bước 4: Chuyển depth_cm → binary label + warning text
    // Dùng let vì có thể bị override bởi no-rain logic bên dưới
    let floodDepthCm = aiResult?.flood_depth_cm ?? 0
    let { label, warningText } = depthCmToWarning(floodDepthCm)

    // ─── NO-RAIN OVERRIDE (logic thực tế) ─────────────────────────────────
    // Nếu OWM xác nhận KHÔNG có mưa (rain1h = 0) VÀ độ ẩm < 90%:
    //   → Force label = 0 (An toàn) bất kể model AI dự đoán gì.
    // Lý do: CatBoost dự đoán depth dựa trên feature địa lý (impervious_ratio
    // cao, elevation thấp ở Hà Nội) → cho depth > ngưỡng dù không có mưa.
    // Ngưỡng 90%: Hà Nội thường đạt 80-90% humidity khi khô ráo.
    // Override chỉ áp dụng khi CÓ live weather (không áp dụng khi OWM lỗi).
    const NO_RAIN_HUMIDITY_THRESHOLD = 90 // %
    const humidity = weatherData?.humidity ?? 100
    const noRainCondition = weatherData !== null && prcp === 0 && humidity < NO_RAIN_HUMIDITY_THRESHOLD

    if (noRainCondition && label === 1) {
      console.info(
        `[FloodPrediction/by-location] No-rain override: rain=0mm, humidity=${humidity}% → An toàn (AI raw depth=${floodDepthCm.toFixed(1)}cm)`
      )
      label = 0
      floodDepthCm = 0
      warningText = 'An toàn'
    }
    // ──────────────────────────────────────────────────────────────────────

    return res.status(200).json({
      success: true,
      data: {
        label,          // 0 = An toàn, 1 = Có ngập
        warningText,    // Chuỗi tiếng Việt cho UI
        floodDepthCm: Math.round(floodDepthCm * 10) / 10,
        weather: {
          rain1h:      weatherData?.rain1h ?? 0,
          humidity:    weatherData?.humidity ?? 0,
          clouds:      weatherData?.clouds ?? 0,
          temp:        weatherData?.temp ?? 0,
          description: weatherData?.description ?? 'N/A',
        },
        usingLiveWeather: weatherData !== null,
        fetchedAt: now.toISOString(),
      },
    })
  } catch (err) {
    return next(err)
  }
})


// ─────────────────────────────────────────────────────────────────────────────
// Route: GET /api/v1/forecasts/latest?lat=&lon=
// V2: Dùng IDW inference thay vì gọi OWM trực tiếp mỗi request.
//   1. Tìm GridNode gần nhất (PostGIS)
//   2. Lấy flood_predictions sát NOW() nhất từ DB
//   3. inferWeatherForNode() → IDW từ virtual stations (hoặc fallback OWM Live)
//   4. Sliding window prcp_3h/6h/12h từ SQL history
// ─────────────────────────────────────────────────────────────────────────────
const { inferWeatherForNode } = require('../services/idwInferenceService')

router.get('/forecasts/latest', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat)
    const lon = Number(req.query.lon)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Tham số lat và lon phải là số thực hợp lệ.' },
      })
    }

    // ── Bước 1: Tìm GridNode gần nhất (bao gồm cả IDW fields) ────────────────
    const [nearestRows] = await sequelize.query(
      `SELECT
         gn.node_id,
         gn.latitude,
         gn.longitude,
         gn.elevation,
         gn.slope,
         gn.impervious_ratio,
         gn.is_out_of_bounds,
         gn.st1_id, gn.st1_weight,
         gn.st2_id, gn.st2_weight,
         gn.st3_id, gn.st3_weight,
         ST_Distance(
           gn.geom::geography,
           ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
         ) AS dist_m
       FROM grid_nodes gn
       ORDER BY ST_Distance(gn.geom::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) ASC
       LIMIT 1`,
      { replacements: { lat, lon } }
    )

    if (!nearestRows || nearestRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Chưa có GridNode nào trong DB. Vui lòng seed dữ liệu.' },
      })
    }

    const nearestNode = nearestRows[0]
    const nodeId = nearestNode.node_id

    // ── Bước 2: Lấy bản ghi dự báo sát NOW() nhất từ DB ─────────────────────
    const [predRows] = await sequelize.query(
      `SELECT
         fp.prediction_id,
         fp.time,
         fp.flood_depth_cm,
         fp.risk_level,
         fp.explanation
       FROM flood_predictions fp
       WHERE fp.node_id = :nodeId
         AND fp.time BETWEEN NOW() - INTERVAL '4 hours'
                        AND NOW() + INTERVAL '4 hours'
       ORDER BY ABS(EXTRACT(EPOCH FROM (fp.time - NOW())))
       LIMIT 1`,
      { replacements: { nodeId } }
    )

    // ── Bước 3: IDW Inference (sliding window + virtual stations) ─────────────
    const weather = await inferWeatherForNode(nearestNode).catch(() => null)

    // ── Bước 4: Fallback real-time AI nếu không có dự báo trong DB ───────────
    if (!predRows || predRows.length === 0) {
      console.info(`[forecasts/latest] Node ${nodeId} chưa có dự báo DB. Fallback real-time AI (IDW)...`)

      const now = new Date()
      const hour = now.getHours()
      const month = now.getMonth() + 1
      const dayofweek = now.getDay() === 0 ? 6 : now.getDay() - 1
      const start = new Date(now.getFullYear(), 0, 0)
      const dayofyear = Math.floor((now - start) / 86400000)
      const rainyMonths = [5, 6, 7, 8, 9, 10]

      const prcp   = weather?.rain_1h  ?? 0
      const prcp3  = weather?.prcp_3h  ?? prcp * 2.5
      const prcp6  = weather?.prcp_6h  ?? prcp * 4
      const prcp12 = weather?.prcp_12h ?? prcp * 6

      const features = {
        prcp, prcp_3h: prcp3, prcp_6h: prcp6, prcp_12h: prcp12, prcp_24h: prcp * 8,
        temp: weather?.temp ?? 28,
        rhum: weather?.rhum ?? 70,
        wspd: 0,
        pres: 1010,
        pressure_change_24h: 0,
        max_prcp_3h: prcp3, max_prcp_6h: prcp6, max_prcp_12h: prcp12,
        // Đọc đúng từ DB — không hardcode
        elevation:        Number(nearestNode.elevation)        || 5,
        slope:            Number(nearestNode.slope)            || 1,
        impervious_ratio: Number(nearestNode.impervious_ratio) || 0.5,
        dist_to_drain_km: 0.4, dist_to_river_km: 1.0,
        dist_to_pump_km: 0.8, dist_to_main_road_km: 0.2, dist_to_park_km: 0.5,
        hour, dayofweek, month, dayofyear,
        hour_sin:  Math.sin((2 * Math.PI * hour)  / 24),
        hour_cos:  Math.cos((2 * Math.PI * hour)  / 24),
        month_sin: Math.sin((2 * Math.PI * month) / 12),
        month_cos: Math.cos((2 * Math.PI * month) / 12),
        rainy_season_flag: rainyMonths.includes(month) ? 1 : 0,
      }

      const aiResult = await predictionService._callAI(features)
      const floodDepthCm = aiResult?.flood_depth_cm ?? 0
      const { label, warningText } = depthCmToWarning(floodDepthCm)
      const riskLevel = floodDepthCm < 15 ? 'safe'
        : floodDepthCm < 30 ? 'medium'
        : floodDepthCm < 60 ? 'high' : 'severe'

      return res.status(200).json({
        success: true,
        source: 'realtime',
        weatherSource: weather?.source ?? 'unknown',
        data: {
          location: `Node ${nodeId} (~${Math.round(nearestNode.dist_m)}m)`,
          time: new Date().toISOString(),
          weather: {
            temp:        weather?.temp   ?? 0,
            prcp:        prcp,
            prcp_3h:     prcp3,
            prcp_6h:     prcp6,
            prcp_12h:    prcp12,
            rhum:        weather?.rhum   ?? 0,
            clouds:      weather?.clouds ?? 0,
            description: 'N/A',
          },
          prediction: {
            flood_depth_cm: Math.round(floodDepthCm * 10) / 10,
            risk_level:     riskLevel,
            explanation:    null,
            label,
            warningText,
          },
          usingLiveWeather: true,
        },
      })
    }

    // ── Bước 5: Có data từ DB → kết hợp IDW weather + DB prediction ──────────
    const pred = predRows[0]
    const floodDepthCm = Number(pred.flood_depth_cm)
    const { label, warningText } = depthCmToWarning(floodDepthCm)

    const prcp   = weather?.rain_1h  ?? 0
    const prcp3  = weather?.prcp_3h  ?? 0
    const prcp6  = weather?.prcp_6h  ?? 0
    const prcp12 = weather?.prcp_12h ?? 0
    const rhum   = weather?.rhum     ?? 70

    // No-rain override (IDW xác nhận không mưa + độ ẩm thấp)
    const noRainOverride = prcp === 0 && rhum < 90 && label === 1
    const finalDepth   = noRainOverride ? 0 : floodDepthCm
    const finalLabel   = noRainOverride ? 0 : label
    const finalWarning = noRainOverride ? 'An toàn' : warningText
    const finalRisk    = noRainOverride ? 'safe' : pred.risk_level
    const finalExpl    = noRainOverride
      ? 'Không có mưa, khu vực hiện đang an toàn.'
      : (pred.explanation ?? null)

    if (noRainOverride) {
      console.info(`[forecasts/latest] No-rain override: rain=0mm, rhum=${rhum}% → An toàn`)
    }

    return res.status(200).json({
      success: true,
      source: 'database',
      weatherSource: weather?.source ?? 'unknown',
      data: {
        location: `Node ${nodeId} (~${Math.round(nearestNode.dist_m)}m)`,
        time: pred.time,
        weather: {
          temp:        weather?.temp   ?? 0,
          prcp,
          prcp_3h:     prcp3,
          prcp_6h:     prcp6,
          prcp_12h:    prcp12,
          rhum,
          clouds:      weather?.clouds ?? 0,
          description: 'N/A',
        },
        prediction: {
          flood_depth_cm: Math.round(finalDepth * 10) / 10,
          risk_level:     finalRisk,
          explanation:    finalExpl,
          label:          finalLabel,
          warningText:    finalWarning,
        },
        usingLiveWeather: true,
      },
    })
  } catch (err) {
    console.error('[forecasts/latest] Lỗi:', err.message)
    return next(err)
  }
})

module.exports = { floodPredictionRouter: router }

