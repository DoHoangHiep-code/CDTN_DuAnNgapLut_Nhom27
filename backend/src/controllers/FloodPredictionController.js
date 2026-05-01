'use strict'

/**
 * FloodPredictionController – Performance Edition
 * ─────────────────────────────────────────────────────────────────────────────
 * getFloodPrediction() – giờ hỗ trợ 2 chế độ:
 *
 *  A) BBox mode (Map trang):
 *     GET /api/v1/flood-prediction?min_lat=&max_lat=&min_lng=&max_lng=&limit=200
 *     → Query flood_predictions JOIN grid_nodes WHERE lat/lng BETWEEN bbox
 *     → Trả PHẦN NHỎ data trong viewport hiện tại (không quét 53K nodes)
 *
 *  B) Legacy mode (không có bbox):
 *     → Fallback về demoData (không gọi AI real-time nữa)
 *     → Dùng cho các trang khác đang cần districts list
 *
 * Lý do không gọi AI real-time: với 53K nodes, mỗi request sẽ timeout.
 * Dữ liệu real-time đã được Cronjob tính sẵn và lưu vào flood_predictions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { buildFloodPrediction } = require('../utils/demoData')
const { QueryTypes } = require('sequelize')

// Kích thước ô lưới (độ) dùng để vẽ polygon quanh mỗi node
const GRID_SIZE = 0.012

// Số records tối đa có thể yêu cầu (chặn client gửi limit=99999)
const MAX_LIMIT = 500
const DEFAULT_LIMIT = 200

/**
 * Tạo shape polygon hình vuông quanh một điểm node.
 * @param {number} lat
 * @param {number} lng
 * @returns {[number, number][]}
 */
function makePolygon(lat, lng) {
  const s = GRID_SIZE
  return [
    [lat - s, lng - s],
    [lat - s, lng + s],
    [lat + s, lng + s],
    [lat + s, lng - s],
  ]
}

class FloodPredictionController {
  /**
   * @param {{ predictionService: any, sequelize: import('sequelize').Sequelize }} deps
   */
  constructor({ predictionService, sequelize }) {
    this.predictionService = predictionService
    this.sequelize = sequelize
    this.getFloodPrediction = this.getFloodPrediction.bind(this)
    this.triggerBatch = this.triggerBatch.bind(this)
  }

  /**
   * GET /api/v1/flood-prediction
   *
   * BBox mode  → query DB trong viewport → trả districts paginated
   * Legacy mode → demoData (không AI real-time)
   */
  async getFloodPrediction(req, res, next) {
    try {
      const minLat = parseFloat(req.query.min_lat)
      const maxLat = parseFloat(req.query.max_lat)
      const minLng = parseFloat(req.query.min_lng)
      const maxLng = parseFloat(req.query.max_lng)
      const hasBbox = [minLat, maxLat, minLng, maxLng].every(Number.isFinite)

      // ── Chế độ BBox (Map dynamic fetch) ─────────────────────────────────────
      if (hasBbox) {
        const limit = Math.min(
          parseInt(req.query.limit) || DEFAULT_LIMIT,
          MAX_LIMIT,
        )

        // Validate bbox hợp lý
        if (minLat >= maxLat || minLng >= maxLng) {
          return res.status(400).json({
            success: false,
            error: { message: 'bbox không hợp lệ: min phải nhỏ hơn max.' },
          })
        }

        // Query flood_predictions JOIN grid_nodes trong bbox
        // Chỉ SELECT các cột cần thiết → giảm payload JSON
        const rows = await this.sequelize.query(
          `SELECT
             gn.node_id,
             gn.latitude,
             gn.longitude,
             gn.location_name,
             fp.risk_level,
             fp.flood_depth_cm,
             fp.time        AS prediction_time,
             fp.explanation
           FROM grid_nodes gn
           LEFT JOIN LATERAL (
             SELECT risk_level, flood_depth_cm, time, explanation
             FROM   flood_predictions
             WHERE  node_id = gn.node_id
             ORDER  BY time DESC
             LIMIT  1
           ) fp ON TRUE
           WHERE gn.latitude  BETWEEN :minLat AND :maxLat
             AND gn.longitude BETWEEN :minLng AND :maxLng
           ORDER BY gn.node_id
           LIMIT :limit`,
          {
            replacements: { minLat, maxLat, minLng, maxLng, limit },
            type: QueryTypes.SELECT,
          },
        )

        if (!rows || rows.length === 0) {
          // Viewport không có node nào → trả mảng rỗng (không fallback demoData)
          return res.status(200).json({
            success: true,
            data: { updatedAtIso: new Date().toISOString(), total: 0, districts: [] },
          })
        }

        const districts = rows.map((r) => ({
          id:                 `node_${r.node_id}`,
          name:               r.location_name || `Node ${r.node_id}`,
          risk:               r.risk_level    || 'safe',
          predictedRainfallMm: 0,
          flood_depth_cm:     Number(r.flood_depth_cm) || 0,
          polygon:            makePolygon(Number(r.latitude), Number(r.longitude)),
          updatedAtIso:       r.prediction_time ?? new Date().toISOString(),
          explanation:        r.explanation ?? null,
        }))

        return res.status(200).json({
          success: true,
          data: {
            updatedAtIso: new Date().toISOString(),
            total: rows.length,
            districts,
          },
        })
      }

      // ── Chế độ Legacy (WeatherPage / ReportsPage filter) ─────────────────────
      // Trả demoData nhẹ (không gọi AI + không scan 53K nodes)
      // Frontend sẽ dùng data này chỉ để populate LocationSearch districts list
      const demo = buildFloodPrediction()
      return res.status(200).json({ success: true, data: demo })
    } catch (err) {
      return next(err)
    }
  }

  /**
   * POST /api/v1/flood-prediction/run
   * Trigger chạy batch prediction thủ công (chỉ dùng khi dev/test).
   */
  async triggerBatch(_req, res, next) {
    try {
      const results = await this.predictionService.runBatchPredictionWithNodes()
      return res.status(200).json({
        success: true,
        count: results?.length ?? 0,
        data: results,
      })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { FloodPredictionController }
