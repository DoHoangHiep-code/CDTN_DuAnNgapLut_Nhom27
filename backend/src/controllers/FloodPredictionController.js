'use strict'

const { buildFloodPrediction } = require('../utils/demoData')

// Kích thước ô lưới (độ) dùng để vẽ polygon quanh mỗi node
const GRID_SIZE = 0.012

function nodeToDistrict(node, prediction) {
  const lat = Number(node.latitude)
  const lng = Number(node.longitude)
  const s = GRID_SIZE
  return {
    id: `node_${node.node_id}`,
    name: node.name || `Node ${node.node_id}`,
    risk: prediction.risk_level,
    predictedRainfallMm: Number(node.prcp) || 0,
    flood_depth_cm: prediction.flood_depth_cm,
    polygon: [
      [lat - s, lng - s],
      [lat - s, lng + s],
      [lat + s, lng + s],
      [lat + s, lng - s],
    ],
    updatedAtIso: new Date().toISOString(),
  }
}

class FloodPredictionController {
  /**
   * @param {{predictionService: any}} deps
   */
  constructor({ predictionService }) {
    this.predictionService = predictionService
    this.getFloodPrediction = this.getFloodPrediction.bind(this)
    this.triggerBatch = this.triggerBatch.bind(this)
  }

  /**
   * GET /api/v1/flood-prediction
   * Trả shape { districts: FloodDistrict[] } mà frontend đang dùng.
   * Nếu AI service chết → fallback về demoData để UI không crash.
   */
  async getFloodPrediction(_req, res, next) {
    try {
      const results = await this.predictionService.runBatchPredictionWithNodes()

      // Nếu AI service chết hoặc DB trống → fallback demoData
      if (!results || !results.length) {
        const demo = buildFloodPrediction()
        return res.status(200).json({ success: true, data: demo })
      }

      const districts = results.map((r) => nodeToDistrict(r.node, r.prediction))

      return res.status(200).json({
        success: true,
        data: {
          updatedAtIso: new Date().toISOString(),
          districts,
        },
      })
    } catch (err) {
      return next(err)
    }
  }

  /**
   * POST /api/v1/flood-prediction/run
   * Trigger chạy batch prediction thủ công, trả raw results.
   */
  async triggerBatch(_req, res, next) {
    try {
      const results = await this.predictionService.runBatchPredictionWithNodes()
      return res.status(200).json({
        success: true,
        count: results.length,
        data: results,
      })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { FloodPredictionController }
