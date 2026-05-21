'use strict'

/**
 * landslideRoutes.js
 * ─────────────────────────────────────────────────────────────
 * API endpoints cho Module Dự báo Sạt lở đất (ML v7 — ONNX)
 *
 * Mount tại: /api/v1/landslide  (xem server.js)
 *
 * TĂNG TỐC (v2 — In-Memory Cache):
 *   /nodes và /hotspots giờ dùng landslideCache (Map<node_id, prediction>)
 *   thay vì CTE ROW_NUMBER() full-scan 425K rows → giảm từ 30s xuống <300ms.
 *
 * Endpoints:
 *   POST /api/v1/landslide/predict   — Dự báo sạt lở từ feature thô
 *   GET  /api/v1/landslide/status    — Kiểm tra trạng thái model
 *   GET  /api/v1/landslide/nodes     — Nodes trong BBox (fast cache path)
 *   GET  /api/v1/landslide/hotspots  — Top N hotspots nguy hiểm nhất
 * ─────────────────────────────────────────────────────────────
 */

const express = require('express')
const { predictLandslide, getModelStatus } = require('../services/landslideInference')
const { sequelize } = require('../../../db/sequelize')
const landslideCache = require('../../../utils/landslideCache')

const router = express.Router()

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/landslide/predict
// ─────────────────────────────────────────────────────────────────────────────
router.post('/predict', async (req, res, next) => {
  try {
    const rawFeatures = req.body
    if (!rawFeatures || typeof rawFeatures !== 'object' || Array.isArray(rawFeatures)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Body phải là JSON object chứa các đặc trưng địa hình/thời tiết.' },
      })
    }
    const result = await predictLandslide(rawFeatures)
    return res.status(200).json({ success: true, data: result })
  } catch (err) {
    if (err.message && err.message.includes('chưa được khởi tạo')) {
      return res.status(503).json({
        success: false,
        error: { message: 'Model ONNX chưa sẵn sàng. Server có thể đang khởi động.', detail: err.message },
      })
    }
    return next(err)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/landslide/status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  const status = getModelStatus()
  const cache  = landslideCache.getStats()
  return res.status(200).json({
    success: true,
    model: status,
    cache: {
      ready:     cache.ready,
      size:      cache.size,
      updatedAt: cache.updatedAt,
    },
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/landslide/nodes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ⚡ FAST PATH (cache populated):
 *   1. Query landslide_grid_nodes WHERE lat/lon bbox  → chỉ trả về cột địa hình
 *   2. In-memory join với landslideCache              → lookup O(1) mỗi node
 *   Tổng: <300ms thay vì 30s+
 *
 * 🐢 SLOW PATH (cache chưa sẵn sàng):
 *   Fallback về CTE query cũ (vẫn chạy được, chỉ chậm hơn)
 */
router.get('/nodes', async (req, res, next) => {
  try {
    const min_lat     = parseFloat(req.query.min_lat)  || 0
    const max_lat     = parseFloat(req.query.max_lat)  || 90
    const min_lng     = parseFloat(req.query.min_lng)  || 0
    const max_lng     = parseFloat(req.query.max_lng)  || 180
    const limit       = Math.min(parseInt(req.query.limit, 10) || 3000, 5000)
    const risk_filter = req.query.risk_filter || 'ALL'

    const cacheStats = landslideCache.getStats()

    // ── ⚡ FAST PATH: Cache đã sẵn sàng ──────────────────────────────────────
    if (cacheStats.ready) {
      // Bước 1: Lấy nodes trong bbox từ landslide_grid_nodes (chỉ cột địa hình)
      // Query này rất nhanh — chỉ cần lat/lon range scan, không join predictions
      const [gridNodes] = await sequelize.query(
        `SELECT node_id, lat, lon, province, slope, twi, elevation, ndvi
         FROM landslide_grid_nodes
         WHERE lat BETWEEN :min_lat AND :max_lat
           AND lon BETWEEN :min_lng AND :max_lng
         LIMIT :bbox_limit`,
        {
          replacements: {
            min_lat, max_lat, min_lng, max_lng,
            // Lấy nhiều hơn limit để sau khi filter risk vẫn đủ kết quả
            bbox_limit: Math.min(limit * 3, 15000),
          },
        }
      )

      // Bước 2: In-memory join với cache (O(n) lookups, không cần DB)
      const nodes = []
      for (const n of gridNodes) {
        const pred = landslideCache.getForNode(n.node_id)
        if (!pred) continue  // node này chưa có dự báo

        // Risk filter
        if (risk_filter === 'DANGER'  && pred.risk_level !== 'DANGER') continue
        if (risk_filter === 'WARNING' && !['WARNING', 'DANGER'].includes(pred.risk_level)) continue

        nodes.push({
          node_id:          n.node_id,
          lat:              parseFloat(n.lat),
          lon:              parseFloat(n.lon),
          province:         n.province,
          slope:            n.slope    != null ? parseFloat(n.slope)    : null,
          twi:              n.twi      != null ? parseFloat(n.twi)      : null,
          elevation:        n.elevation!= null ? parseFloat(n.elevation): null,
          ndvi:             n.ndvi     != null ? parseFloat(n.ndvi)     : null,
          prob_landslide:   pred.prob_landslide,
          risk_level:       pred.risk_level,
          rain_7d_accum:    pred.rain_7d_accum,
          api_7d:           pred.api_7d,
          soil_moisture_1d: pred.soil_moisture_1d,
          prediction_time:  pred.prediction_time,
        })
      }

      // Bước 3: Sort theo prob giảm dần, cắt limit
      nodes.sort((a, b) => (b.prob_landslide ?? 0) - (a.prob_landslide ?? 0))

      return res.status(200).json({
        success: true,
        source:  'cache',
        cache_size: cacheStats.size,
        nodes:   nodes.slice(0, limit),
      })
    }

    // ── 🐢 SLOW PATH: Cache chưa sẵn sàng → fallback về DB ─────────────────
    console.warn('[LandslideRoutes] Cache chưa sẵn sàng, dùng DB query (chậm)...')
    let riskCondition = ''
    if (risk_filter === 'DANGER')  riskCondition = "AND p.risk_level = 'DANGER'"
    else if (risk_filter === 'WARNING') riskCondition = "AND p.risk_level IN ('WARNING', 'DANGER')"

    const query = `
      WITH LatestPreds AS (
        SELECT node_id, prob_landslide, risk_level, rain_7d_accum, api_7d, soil_moisture_1d, prediction_time,
               ROW_NUMBER() OVER(PARTITION BY node_id ORDER BY prediction_time DESC) AS rn
        FROM landslide_predictions
      )
      SELECT
        n.node_id, n.lat, n.lon, n.province, n.slope, n.twi, n.elevation, n.ndvi,
        p.prob_landslide, p.risk_level, p.rain_7d_accum, p.api_7d, p.soil_moisture_1d, p.prediction_time
      FROM landslide_grid_nodes n
      JOIN LatestPreds p ON n.node_id = p.node_id AND p.rn = 1
      WHERE n.lat BETWEEN :min_lat AND :max_lat
        AND n.lon BETWEEN :min_lng AND :max_lng
        ${riskCondition}
      ORDER BY p.prob_landslide DESC NULLS LAST
      LIMIT :limit
    `
    const [nodes] = await sequelize.query(query, {
      replacements: { min_lat, max_lat, min_lng, max_lng, limit },
    })
    return res.status(200).json({ success: true, source: 'db', nodes })

  } catch (err) {
    console.error('[LandslideRoutes] Lỗi /nodes:', err.message)
    return next(err)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/landslide/hotspots
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Trả về top-N điểm nóng DANGER/WARNING có xác suất cao nhất.
 * ⚡ Fast path: quét cache Map, lấy top-N theo prob_landslide.
 */
router.get('/hotspots', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50)
    const cacheStats = landslideCache.getStats()

    // ── ⚡ FAST PATH ─────────────────────────────────────────────────────────
    if (cacheStats.ready) {
      // Scan cache để lấy top DANGER/WARNING nodes theo prob_landslide
      // Cache có 425K entries → scan ~5ms (JavaScript Map iteration rất nhanh)
      const candidates = []
      // landslideCache không expose raw Map, cần query grid nodes với province info
      // Dùng DB query chỉ cho grid_nodes (không cần predictions)
      // Lấy top 200 hotspot node_ids từ cache trước
      const topNodeIds = getTopNodeIdsFromCache(limit * 20) // lấy nhiều để có đủ sau khi join

      if (topNodeIds.length > 0) {
        // Query thông tin địa lý cho các node đó
        const placeholders = topNodeIds.map((_, i) => `:id${i}`).join(', ')
        const replacements = {}
        topNodeIds.forEach((id, i) => { replacements[`id${i}`] = id })

        const [gridNodes] = await sequelize.query(
          `SELECT node_id, lat, lon, province, slope, twi, elevation, ndvi
           FROM landslide_grid_nodes
           WHERE node_id IN (${placeholders})`,
          { replacements }
        )

        for (const n of gridNodes) {
          const pred = landslideCache.getForNode(n.node_id)
          if (!pred || !['DANGER', 'WARNING'].includes(pred.risk_level)) continue
          candidates.push({
            node_id: n.node_id, lat: parseFloat(n.lat), lon: parseFloat(n.lon),
            province: n.province, slope: n.slope, twi: n.twi, elevation: n.elevation, ndvi: n.ndvi,
            prob_landslide: pred.prob_landslide, risk_level: pred.risk_level,
            rain_7d_accum: pred.rain_7d_accum, api_7d: pred.api_7d,
            soil_moisture_1d: pred.soil_moisture_1d, prediction_time: pred.prediction_time,
          })
        }

        candidates.sort((a, b) => (b.prob_landslide ?? 0) - (a.prob_landslide ?? 0))
        return res.status(200).json({
          success: true, source: 'cache',
          nodes: candidates.slice(0, limit),
        })
      }
    }

    // ── 🐢 SLOW PATH fallback ────────────────────────────────────────────────
    const query = `
      WITH LatestPreds AS (
        SELECT node_id, prob_landslide, risk_level, rain_7d_accum, api_7d, soil_moisture_1d, prediction_time,
               ROW_NUMBER() OVER(PARTITION BY node_id ORDER BY prediction_time DESC) AS rn
        FROM landslide_predictions
      )
      SELECT
        n.node_id, n.lat, n.lon, n.province, n.slope, n.twi, n.elevation, n.ndvi,
        p.prob_landslide, p.risk_level, p.rain_7d_accum, p.api_7d, p.soil_moisture_1d, p.prediction_time
      FROM landslide_grid_nodes n
      JOIN LatestPreds p ON n.node_id = p.node_id AND p.rn = 1
      WHERE p.risk_level IN ('DANGER', 'WARNING')
      ORDER BY p.prob_landslide DESC NULLS LAST
      LIMIT :limit
    `
    const [nodes] = await sequelize.query(query, { replacements: { limit } })
    return res.status(200).json({ success: true, source: 'db', nodes })

  } catch (err) {
    console.error('[LandslideRoutes] Lỗi /hotspots:', err.message)
    return next(err)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Lấy top-N node_ids từ cache theo prob_landslide (không cần DB)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Scan toàn bộ cache Map để tìm các entries có risk_level DANGER/WARNING,
 * sort theo prob_landslide giảm dần, trả về top-N node_ids.
 *
 * Hiệu suất: Map.entries() trên 425K entries mất ~5-15ms (chấp nhận được cho hotspots).
 * @param {number} n
 * @returns {string[]}
 */
function getTopNodeIdsFromCache(n) {
  // Truy cập internal state của landslideCache
  // landslideCache không expose raw Map, nên dùng getForNode scan approach khác:
  // Ta build array từ cache bằng cách đọc qua module internal
  // SOLUTION: Export thêm hàm scanTop từ landslideCache
  if (typeof landslideCache.scanTop === 'function') {
    return landslideCache.scanTop(n)
  }
  return []
}

module.exports = { landslideRouter: router }
