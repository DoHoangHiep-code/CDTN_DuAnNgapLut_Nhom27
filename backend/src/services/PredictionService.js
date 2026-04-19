'use strict'

const axios = require('axios')

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000'
const AI_TIMEOUT_MS = 5000

class PredictionService {
  /**
   * @param {{weatherRepository: any, sequelize: any}} deps
   */
  constructor({ weatherRepository, sequelize }) {
    this.weatherRepository = weatherRepository
    this.sequelize = sequelize
  }

  // -------------------------------------------------------------------------
  // Gọi AI service: 1 node, trả {flood_depth_cm, risk_level} hoặc null
  // -------------------------------------------------------------------------
  async _callAI(features) {
    try {
      const res = await axios.post(`${AI_SERVICE_URL}/api/predict`, features, {
        timeout: AI_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      })
      return res.data
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        console.error('[PredictionService] AI timeout sau', AI_TIMEOUT_MS, 'ms')
      } else {
        console.error('[PredictionService] AI error:', err.message)
      }
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Gọi AI service batch: [{features}, ...] → [{flood_depth_cm, risk_level}]
  // -------------------------------------------------------------------------
  async _callAIBatch(featuresArray) {
    try {
      const res = await axios.post(`${AI_SERVICE_URL}/api/predict/batch`, featuresArray, {
        timeout: AI_TIMEOUT_MS * 3,
        headers: { 'Content-Type': 'application/json' },
      })
      return res.data
    } catch (err) {
      console.error('[PredictionService] AI batch error:', err.message)
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Build feature object từ DB row + thêm time features
  // -------------------------------------------------------------------------
  _buildFeatures(row) {
    const t = new Date(row.time)
    const hour = t.getHours()
    const month = t.getMonth() + 1
    const dayofweek = t.getDay() === 0 ? 6 : t.getDay() - 1 // 0=Mon, 6=Sun
    const start = new Date(t.getFullYear(), 0, 0)
    const dayofyear = Math.floor((t - start) / 86400000)
    const rainyMonths = [5, 6, 7, 8, 9, 10]

    return {
      prcp:               Number(row.prcp) || 0,
      prcp_3h:            Number(row.prcp_3h) || 0,
      prcp_6h:            Number(row.prcp_6h) || 0,
      prcp_12h:           Number(row.prcp_12h) || 0,
      prcp_24h:           Number(row.prcp_24h) || 0,
      temp:               Number(row.temp) || 28,
      rhum:               Number(row.rhum) || 70,
      wspd:               Number(row.wspd) || 0,
      pres:               Number(row.pres) || 1010,
      pressure_change_24h: Number(row.pressure_change_24h) || 0,
      max_prcp_3h:        Number(row.max_prcp_3h) || 0,
      max_prcp_6h:        Number(row.max_prcp_6h) || 0,
      max_prcp_12h:       Number(row.max_prcp_12h) || 0,
      elevation:          Number(row.elevation) || 5,
      slope:              Number(row.slope) || 1,
      impervious_ratio:   Number(row.impervious_ratio) || 0.5,
      dist_to_drain_km:   Number(row.dist_to_drain_km) || 0.5,
      dist_to_river_km:   Number(row.dist_to_river_km) || 1.0,
      dist_to_pump_km:    Number(row.dist_to_pump_km) || 1.0,
      dist_to_main_road_km: Number(row.dist_to_main_road_km) || 0.3,
      dist_to_park_km:    Number(row.dist_to_park_km) || 0.5,
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
  }

  // -------------------------------------------------------------------------
  // Lưu kết quả dự đoán vào bảng flood_predictions
  // -------------------------------------------------------------------------
  async _savePrediction(nodeId, predictionTime, floodDepthCm, riskLevel) {
    await this.sequelize.query(
      `INSERT INTO flood_predictions (node_id, time, flood_depth_cm, risk_level)
       VALUES (:nodeId, :time, :depth, :risk)
       ON CONFLICT DO NOTHING;`,
      {
        replacements: {
          nodeId,
          time: predictionTime,
          depth: floodDepthCm,
          risk: riskLevel,
        },
      },
    )
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Dự đoán cho 1 node, trả kết quả
  // -------------------------------------------------------------------------
  async predictForNode(nodeId) {
    const row = await this.weatherRepository.getFeaturesForPrediction(nodeId)
    if (!row) return null

    const features = this._buildFeatures(row)
    const result = await this._callAI(features)
    if (!result) return null

    await this._savePrediction(nodeId, new Date(), result.flood_depth_cm, result.risk_level)
    return result
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Chạy batch prediction cho TẤT CẢ nodes
  // Dùng cho cron job hoặc /api/v1/flood-prediction
  // -------------------------------------------------------------------------
  async runBatchPrediction() {
    const nodeIds = await this.weatherRepository.getAllNodeIds()
    if (!nodeIds.length) return []

    // Lấy features song song (tối đa 10 cùng lúc để không quá tải DB)
    const CHUNK = 10
    const allFeatures = []
    for (let i = 0; i < nodeIds.length; i += CHUNK) {
      const chunk = nodeIds.slice(i, i + CHUNK)
      const rows = await Promise.all(
        chunk.map((id) => this.weatherRepository.getFeaturesForPrediction(id))
      )
      for (let j = 0; j < chunk.length; j++) {
        allFeatures.push({ nodeId: chunk[j], row: rows[j] })
      }
    }

    const validItems = allFeatures.filter((x) => x.row !== null)
    if (!validItems.length) return []

    const featuresArray = validItems.map((x) => this._buildFeatures(x.row))
    const results = await this._callAIBatch(featuresArray)
    if (!results) return []

    const now = new Date()
    const saved = []
    for (let i = 0; i < validItems.length; i++) {
      const r = results[i]
      if (!r) continue
      await this._savePrediction(validItems[i].nodeId, now, r.flood_depth_cm, r.risk_level)
      saved.push({ nodeId: validItems[i].nodeId, ...r })
    }

    console.log(`[PredictionService] Batch: ${saved.length}/${nodeIds.length} nodes predicted.`)
    return saved
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Batch prediction + trả kèm node info (lat/lng/prcp)
  // Dùng cho FloodPredictionController để build FloodDistrict shape cho frontend
  // -------------------------------------------------------------------------
  async runBatchPredictionWithNodes() {
    const nodeRows = await this.weatherRepository.getAllNodesWithLatestWeather()
    if (!nodeRows.length) return []

    const validItems = nodeRows.filter((r) => r.lat != null)
    if (!validItems.length) return []

    const featuresArray = validItems.map((r) => this._buildFeatures(r))
    const results = await this._callAIBatch(featuresArray)
    if (!results) return []

    const now = new Date()
    const out = []
    for (let i = 0; i < validItems.length; i++) {
      const r = results[i]
      if (!r) continue
      const n = validItems[i]
      await this._savePrediction(n.node_id, now, r.flood_depth_cm, r.risk_level)
      out.push({
        node: {
          node_id: n.node_id,
          latitude: n.lat,
          longitude: n.lng,
          name: n.name || null,
          prcp: n.prcp,
        },
        prediction: r,
      })
    }

    console.log(`[PredictionService] WithNodes: ${out.length}/${nodeRows.length} nodes predicted.`)
    return out
  }
}

module.exports = { PredictionService }
