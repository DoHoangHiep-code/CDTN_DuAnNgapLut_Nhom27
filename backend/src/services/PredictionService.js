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
    let nodeRows
    try {
      nodeRows = await this.weatherRepository.getAllNodesWithLatestWeather()
    } catch (err) {
      console.error('[PredictionService] DB error, returning empty:', err.message)
      return []
    }
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

  // -------------------------------------------------------------------------
  // PUBLIC: Sincronizar predictions com weather_measurements
  // Encontra e cria predictions para todos os gaps (weather sem prediction)
  // -------------------------------------------------------------------------
  async syncPredictionsWithWeather(limit = 200, batchSize = 20) {
    console.log(`[PredictionService] Iniciando sync de predictions com weather (limit=${limit})...`)

    // 1. Encontrar gaps: weather que não tem prediction
    const gapQuery = `
      SELECT DISTINCT
        w.node_id,
        w.time,
        w.temp,
        w.rhum,
        w.prcp,
        w.prcp_3h,
        w.prcp_6h,
        w.prcp_12h,
        w.prcp_24h,
        w.wspd,
        w.pres,
        w.pressure_change_24h,
        w.max_prcp_3h,
        w.max_prcp_6h,
        w.max_prcp_12h,
        gn.elevation,
        gn.slope,
        gn.impervious_ratio,
        gn.dist_to_drain_km,
        gn.dist_to_river_km,
        gn.dist_to_pump_km,
        gn.dist_to_main_road_km,
        gn.dist_to_park_km,
        gn.location_name
      FROM weather_measurements w
      LEFT JOIN grid_nodes gn ON w.node_id = gn.node_id
      LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
      WHERE fp.prediction_id IS NULL
      ORDER BY w.time DESC, w.node_id
      LIMIT :limit
    `

    const gaps = await this.sequelize.query(gapQuery, {
      replacements: { limit },
      type: this.sequelize.QueryTypes.SELECT,
    })

    if (!gaps.length) {
      console.log(`[PredictionService] Nenhum gap encontrado. Sync completo! ✅`)
      return { processed: 0, success: 0, failed: 0, gaps: 0 }
    }

    console.log(`[PredictionService] Encontrados ${gaps.length} gaps. Processando...`)

    let success = 0
    let failed = 0

    // 2. Processar em chunks de batchSize
    for (let i = 0; i < gaps.length; i += batchSize) {
      const chunk = gaps.slice(i, i + batchSize)
      const featuresArray = chunk.map(row => this._buildFeatures(row))

      // Chamar AI em batch
      const results = await this._callAIBatch(featuresArray)

      if (results && Array.isArray(results)) {
        for (let j = 0; j < chunk.length; j++) {
          const row = chunk[j]
          const result = results[j]

          try {
            if (result && result.flood_depth_cm !== undefined && result.risk_level) {
              await this._savePrediction(
                row.node_id,
                row.time,
                result.flood_depth_cm,
                result.risk_level
              )
              success++
            } else {
              failed++
            }
          } catch (err) {
            console.error(`[PredictionService] Erro salvando prediction node=${row.node_id}:`, err.message)
            failed++
          }
        }
      } else {
        failed += chunk.length
      }

      console.log(`[PredictionService] Progresso: ${Math.min(i + batchSize, gaps.length)}/${gaps.length}`)
    }

    console.log(`[PredictionService] Sync concluído: ${success} sucesso, ${failed} falhas`)
    return { processed: gaps.length, success, failed, gaps: gaps.length }
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Validar integridade de predictions vs weather
  // Retorna estatísticas de cobertura
  // -------------------------------------------------------------------------
  async validateCoverage() {
    const [weatherCount] = await this.sequelize.query(
      `SELECT COUNT(*) as cnt FROM weather_measurements`,
      { type: this.sequelize.QueryTypes.SELECT }
    )

    const [predictionCount] = await this.sequelize.query(
      `SELECT COUNT(*) as cnt FROM flood_predictions`,
      { type: this.sequelize.QueryTypes.SELECT }
    )

    const [gapCount] = await this.sequelize.query(
      `SELECT COUNT(DISTINCT (w.node_id, w.time)) as gap_count
       FROM weather_measurements w
       LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
       WHERE fp.prediction_id IS NULL`,
      { type: this.sequelize.QueryTypes.SELECT }
    )

    const coverage = weatherCount.cnt > 0
      ? ((weatherCount.cnt - gapCount.gap_count) / weatherCount.cnt * 100).toFixed(2)
      : 0

    return {
      weatherTotal: weatherCount.cnt,
      predictionTotal: predictionCount.cnt,
      gaps: gapCount.gap_count,
      coverage: `${coverage}%`,
    }
  }
}

module.exports = { PredictionService }
