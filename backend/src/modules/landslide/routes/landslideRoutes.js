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
const { cacheResponse, invalidateCacheNamespace } = require('../../../middlewares/apiCache')

const router = express.Router()

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/landslide/clear-cache
// ─────────────────────────────────────────────────────────────────────────────
router.post('/clear-cache', async (_req, res) => {
  try {
    invalidateCacheNamespace('landslide_api')
    // Trigger in-memory map reload async
    landslideCache.loadCache().catch(e => console.error('[LandslideCache] Reload error:', e))
    return res.status(200).json({ success: true, message: 'Đã xóa HTTP Cache và nạp lại in-memory Cache Sạt lở.' })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

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
// GET /api/v1/landslide/dashboard
// ─────────────────────────────────────────────────────────────────────────────
router.get('/dashboard', cacheResponse(1 * 3600, 'landslide_api'), async (req, res, next) => {
  try {
    const cacheStats = landslideCache.getStats()
    if (!cacheStats.ready) {
      return res.status(503).json({
        success: false,
        error: { message: 'Đang tải dữ liệu sạt lở vào bộ nhớ đệm, vui lòng thử lại sau giây lát...' }
      })
    }

    const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 3)
    const stats = landslideCache.getDashboardStats(offset)
    
    // SQL cho xu hướng API7d 7 ngày qua
    const [trendRows] = await sequelize.query(`
      SELECT DATE_TRUNC('day', prediction_time) as day, AVG(api_7d) as mm
      FROM landslide_predictions
      WHERE prediction_time >= NOW() - INTERVAL '7 days'
        AND prediction_time <= NOW()
      GROUP BY 1 ORDER BY 1
    `)

    // SQL cho dự báo mưa 3 ngày tới
    const [forecastRows] = await sequelize.query(`
      SELECT DATE_TRUNC('day', prediction_time) as day, AVG(api_7d) as mm
      FROM landslide_predictions
      WHERE prediction_time > NOW()
        AND prediction_time <= NOW() + INTERVAL '3 days'
      GROUP BY 1 ORDER BY 1
    `)

    return res.status(200).json({
      success: true,
      data: {
        ...stats,
        rain_trend: trendRows.map(r => ({
          day: new Date(r.day).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
          mm: parseFloat(r.mm).toFixed(1)
        })),
        rain_forecast_3d: forecastRows.map(r => ({
          day: new Date(r.day).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
          mm: parseFloat(r.mm).toFixed(1)
        }))
      }
    })
  } catch (err) {
    next(err)
  }
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
router.get('/nodes', cacheResponse(12 * 3600, 'landslide_api'), async (req, res, next) => {
  try {
    const min_lat     = parseFloat(req.query.min_lat)  || 0
    const max_lat     = parseFloat(req.query.max_lat)  || 90
    const min_lng     = parseFloat(req.query.min_lng)  || 0
    const max_lng     = parseFloat(req.query.max_lng)  || 180
    const limit       = Math.min(parseInt(req.query.limit, 10) || 3000, 5000)
    const risk_filter = req.query.risk_filter || 'ALL'

    const offset      = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 3)

    const cacheStats = landslideCache.getStats()

    if (!cacheStats.ready) {
      return res.status(503).json({
        success: false,
        error: { message: 'Đang nạp dữ liệu sạt lở từ CSDL, vui lòng thử lại sau.' },
      })
    }

    // ── ⚡ FAST PATH: Cache đã sẵn sàng ──────────────────────────────────────
    // Bước 1: Lấy nodes trong bbox từ landslide_grid_nodes (chỉ cột địa hình)
      // Query này rất nhanh — chỉ cần lat/lon range scan, không join predictions
      const [gridNodes] = await sequelize.query(
        `SELECT node_id, lat, lon, province, location_name, slope, twi, elevation, ndvi
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
        const pred = landslideCache.getForNode(n.node_id, offset)
        if (!pred) continue  // node này chưa có dự báo

        // Risk filter
        if (risk_filter === 'DANGER'  && pred.risk_level !== 'DANGER') continue
        if (risk_filter === 'WARNING' && !['WARNING', 'DANGER'].includes(pred.risk_level)) continue

        nodes.push({
          node_id:          n.node_id,
          lat:              parseFloat(n.lat),
          lon:              parseFloat(n.lon),
          province:         n.province,
          location_name:    n.location_name,
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
    // NOTE: The SLOW PATH DB fallback was removed here because cacheStats.ready is strictly enforced above.

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
router.get('/hotspots', cacheResponse(12 * 3600, 'landslide_api'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50)
    const cacheStats = landslideCache.getStats()

    if (!cacheStats.ready) {
      return res.status(503).json({
        success: false,
        error: { message: 'Đang nạp dữ liệu sạt lở từ CSDL, vui lòng thử lại sau.' },
      })
    }

    // ── ⚡ FAST PATH ─────────────────────────────────────────────────────────
    // Scan cache để lấy top DANGER/WARNING nodes theo prob_landslide
    // Cache có 425K entries → scan ~5ms (JavaScript Map iteration rất nhanh)
      const candidates = []
      // landslideCache không expose raw Map, cần query grid nodes với province info
      // Dùng DB query chỉ cho grid_nodes (không cần predictions)
      // Lấy top 200 hotspot node_ids từ cache trước
      // Hotspot mặc định lấy cho offset=0 (hôm nay) để hiển thị Dashboard
      const topNodeIds = getTopNodeIdsFromCache(limit * 20) // lấy nhiều để có đủ sau khi join

      if (topNodeIds.length > 0) {
        // Query thông tin địa lý cho các node đó
        const placeholders = topNodeIds.map((_, i) => `:id${i}`).join(', ')
        const replacements = {}
        topNodeIds.forEach((id, i) => { replacements[`id${i}`] = id })

        const [gridNodes] = await sequelize.query(
          `SELECT node_id, lat, lon, province, location_name, slope, twi, elevation, ndvi
           FROM landslide_grid_nodes
           WHERE node_id IN (${placeholders})`,
          { replacements }
        )

        for (const n of gridNodes) {
          const pred = landslideCache.getForNode(n.node_id, 0)
          if (!pred || !['DANGER', 'WARNING'].includes(pred.risk_level)) continue
          candidates.push({
            node_id: n.node_id, lat: parseFloat(n.lat), lon: parseFloat(n.lon),
            province: n.province, location_name: n.location_name, slope: n.slope, twi: n.twi, elevation: n.elevation, ndvi: n.ndvi,
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
      
      // Nếu topNodeIds.length === 0, trả về rỗng
      return res.status(200).json({ success: true, source: 'cache', nodes: [] })
    // NOTE: SLOW PATH was removed because cacheStats.ready is enforced.

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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/landslide/search
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Tìm kiếm các điểm sạt lở theo tên địa danh (location_name) hoặc tỉnh (province).
 */
router.get('/search', async (req, res, next) => {
  try {
    const q = req.query.q || ''
    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, nodes: [] })
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50)
    
    // Tìm kiếm trong grid_nodes
    const [gridNodes] = await sequelize.query(
      `SELECT node_id, lat, lon, province, location_name
       FROM landslide_grid_nodes
       WHERE location_name ILIKE :query OR province ILIKE :query
       LIMIT :limit`,
      {
        replacements: { query: `%${q}%`, limit }
      }
    )

    // Lấy thông tin dự báo từ cache
    const results = gridNodes.map(n => {
      const pred = landslideCache.getForNode(n.node_id) || {}
      return {
        node_id: n.node_id,
        lat: parseFloat(n.lat),
        lon: parseFloat(n.lon),
        province: n.province,
        location_name: n.location_name,
        prob_landslide: pred.prob_landslide || null,
        risk_level: pred.risk_level || 'UNKNOWN'
      }
    })

    return res.status(200).json({ success: true, nodes: results })
  } catch (err) {
    console.error('[LandslideRoutes] Lỗi /search:', err.message)
    return next(err)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/landslide/nearest-node
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Tìm node sạt lở gần nhất với tọa độ (lat, lon) cho trước.
 */
router.get('/nearest-node', async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu lat hoặc lon hợp lệ.' } });
    }

    // Dùng khoảng cách Euclid cơ bản. (Tối ưu: dùng PostGIS ST_Distance nếu có index)
    const [gridNodes] = await sequelize.query(
      `SELECT node_id, lat, lon, province, location_name, slope, twi, elevation, ndvi,
              tpi, tri, roughness, ndwi, bsi, lulc_class, dist_to_river_m, dist_to_road_m,
              ((lat - :lat)*(lat - :lat) + (lon - :lon)*(lon - :lon)) as dist
       FROM landslide_grid_nodes
       ORDER BY dist ASC
       LIMIT 1`,
      { replacements: { lat, lon } }
    );

    if (!gridNodes || gridNodes.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Không tìm thấy node nào.' } });
    }

    const n = gridNodes[0];
    const pred = landslideCache.getForNode(n.node_id) || {};

    const result = {
      node_id: n.node_id,
      lat: parseFloat(n.lat),
      lon: parseFloat(n.lon),
      province: n.province,
      location_name: n.location_name,
      slope: n.slope != null ? parseFloat(n.slope) : null,
      twi: n.twi != null ? parseFloat(n.twi) : null,
      elevation: n.elevation != null ? parseFloat(n.elevation) : null,
      ndvi: n.ndvi != null ? parseFloat(n.ndvi) : null,
      tpi: n.tpi != null ? parseFloat(n.tpi) : null,
      tri: n.tri != null ? parseFloat(n.tri) : null,
      roughness: n.roughness != null ? parseFloat(n.roughness) : null,
      ndwi: n.ndwi != null ? parseFloat(n.ndwi) : null,
      bsi: n.bsi != null ? parseFloat(n.bsi) : null,
      lulc_class: n.lulc_class != null ? parseInt(n.lulc_class, 10) : null,
      dist_to_river_m: n.dist_to_river_m != null ? parseFloat(n.dist_to_river_m) : null,
      dist_to_road_m: n.dist_to_road_m != null ? parseFloat(n.dist_to_road_m) : null,
      dist_sq: n.dist,
      prob_landslide: pred.prob_landslide || null,
      risk_level: pred.risk_level || 'UNKNOWN',
      rain_7d_accum: pred.rain_7d_accum || null,
      api_7d: pred.api_7d || null,
      soil_moisture_1d: pred.soil_moisture_1d || null,
    };

    return res.status(200).json({ success: true, node: result });
  } catch (err) {
    console.error('[LandslideRoutes] Lỗi /nearest-node:', err.message);
    return next(err);
  }
});

module.exports = { landslideRouter: router }
