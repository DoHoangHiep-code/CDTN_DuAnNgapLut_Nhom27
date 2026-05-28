'use strict'

/**
 * landslideService.js
 * ─────────────────────────────────────────────────────────────
 * Nghiệp vụ xử lý sạt lở cho Chatbot (Tình trạng, Hotspots, Phân tích)
 * ─────────────────────────────────────────────────────────────
 */

const { Pool } = require('pg')
const landslideCache = require('../../../utils/landslideCache')
const onnxRunner = require('./onnxRunner')

const TZ = 'Asia/Ho_Chi_Minh'
const DB_TIMEOUT_MS = 8000

// Helper format thời gian
function formatVN(dt) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(dt instanceof Date ? dt : new Date(dt))
}

function safeNumber(val, decimals = 1, fallback = 0) {
  const n = Number(val)
  return Number.isFinite(n) ? n.toFixed(decimals) : Number(fallback).toFixed(decimals)
}

/**
 * Tính điểm rủi ro sạt lở nội bộ (0-10) để đánh giá nhanh
 */
function computeLandslideRiskScore(f) {
  let score = 0

  // 1. Độ dốc (tối đa 3 điểm)
  const slope = Number(f.slope || 0)
  if (slope >= 35) score += 3
  else if (slope >= 25) score += 2
  else if (slope >= 15) score += 1

  // 2. Lượng mưa lũy kế API 7 ngày (tối đa 3 điểm)
  const api7 = Number(f.api_7d || 0)
  if (api7 >= 120) score += 3
  else if (api7 >= 80) score += 2
  else if (api7 >= 40) score += 1

  // 3. Độ ẩm đất 1 ngày (tối đa 2 điểm)
  const sm1d = Number(f.soil_moisture_1d || 0)
  if (sm1d >= 0.45) score += 2
  else if (sm1d >= 0.35) score += 1

  // 4. Lớp che phủ NDVI (tối đa 2 điểm)
  const ndvi = Number(f.ndvi || 0.6)
  if (ndvi <= 0.3) score += 2
  else if (ndvi <= 0.5) score += 1

  return Math.min(score, 10)
}

function getRiskTextLabel(score) {
  if (score >= 7) return 'CAO 🔴'
  if (score >= 4) return 'TRUNG BÌNH 🟡'
  return 'THẤP 🟢'
}

class LandslideChatbotService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    })
  }

  async withTimeout(promise, ms = DB_TIMEOUT_MS) {
    let t
    const tp = new Promise((_, reject) => {
      t = setTimeout(() => reject(Object.assign(new Error(`Query timeout ${ms}ms`), { code: 'QUERY_TIMEOUT' })), ms)
    })
    return Promise.race([promise, tp]).finally(() => clearTimeout(t))
  }

  /**
   * Truy vấn thông tin chi tiết của các node từ danh sách IDs
   */
  async getNodesDetails(nodeIds) {
    try {
      if (!nodeIds || nodeIds.length === 0) return []
      const sql = `
        SELECT gn.node_id, gn.location_name, gn.province, gn.lat, gn.lon, gn.slope, gn.elevation, 
               gn.dist_to_river_m, gn.dist_to_road_m, gn.ndvi, gn.bsi, gn.tpi,
               fp.prob_landslide, fp.risk_level, fp.prediction_time,
               fp.rain_1d_accum, fp.rain_7d_accum, fp.rain_30d_accum, fp.api_7d, fp.api_14d,
               fp.soil_moisture_1d, fp.soil_moisture_7d
        FROM landslide_grid_nodes gn
        LEFT JOIN (
          SELECT DISTINCT ON (node_id) *
          FROM landslide_predictions
          WHERE node_id = ANY($1)
          ORDER BY node_id, prediction_time DESC
        ) fp ON gn.node_id = fp.node_id
        WHERE gn.node_id = ANY($1)
      `
      const { rows } = await this.withTimeout(this.pool.query(sql, [nodeIds]))
      return rows
    } catch (err) {
      console.error('[LandslideService][getNodesDetails] Lỗi:', err.message)
      return []
    }
  }

  /**
   * Intent 1: Tình trạng sạt lở hiện tại
   */
  async queryCurrentStatus() {
    try {
      const cacheStats = landslideCache.getStats()
      if (cacheStats.ready) {
        const topIds = landslideCache.scanTop(10)
        if (topIds.length > 0) {
          const rows = await this.getNodesDetails(topIds)
          // Lọc và sắp xếp theo prob_landslide giảm dần
          return rows.sort((a, b) => (b.prob_landslide || 0) - (a.prob_landslide || 0))
        }
        return []
      }

      // Fallback: Query trực tiếp DB
      const sql = `
        SELECT sub.node_id, sub.prob_landslide, sub.risk_level, sub.prediction_time,
               gn.location_name, gn.province, gn.lat, gn.lon, gn.slope, gn.elevation,
               sub.rain_1d_accum, sub.rain_7d_accum, sub.api_7d, sub.api_14d, sub.soil_moisture_1d, sub.soil_moisture_7d
        FROM (
          SELECT DISTINCT ON (node_id) *
          FROM landslide_predictions
          WHERE prediction_time >= NOW() - INTERVAL '4 hours'
            AND risk_level IN ('DANGER', 'WARNING')
          ORDER BY node_id, prediction_time DESC
        ) sub
        JOIN landslide_grid_nodes gn ON gn.node_id = sub.node_id
        ORDER BY sub.prob_landslide DESC
        LIMIT 10
      `
      const { rows } = await this.withTimeout(this.pool.query(sql))
      return rows
    } catch (err) {
      console.error('[LandslideService][queryCurrentStatus] Lỗi:', err.message)
      return []
    }
  }

  formatCurrentStatus(rows) {
    const now = formatVN(new Date())
    let md = `⛰️ Báo Cáo Tình Trạng Sạt Lở (Cập nhật lúc ${now})\n`
    md += `Chào bạn! Dựa trên dữ liệu lượng mưa tích lũy, độ ẩm đất và mô hình địa hình, tình hình nguy cơ sạt lở hiện tại được ghi nhận như sau:\n\n`

    md += `### 1. Các khu vực CÓ NGUY CƠ CAO (Cập nhật thực tế):\n`

    const dangerRows = rows.filter(r => r.risk_level === 'DANGER')
    const warningRows = rows.filter(r => r.risk_level === 'WARNING')
    const hasDangerOrWarning = rows.length > 0

    if (!hasDangerOrWarning) {
      md += `- ✅ Hiện chưa ghi nhận điểm sạt lở nghiêm trọng nào.\n`
    } else {
      rows.slice(0, 5).forEach(r => {
        const name = r.location_name || `Khu vực tại (${safeNumber(r.lat, 4)}°N, ${safeNumber(r.lon, 4)}°E)`
        const riskLabelText = r.risk_level === 'DANGER' ? 'Rất cao' : 'Cao'
        md += `- 🔴 Khu vực **${name}**, Nguy cơ: **${riskLabelText}** (Xác suất sạt lở: ${(Number(r.prob_landslide || 0) * 100).toFixed(1)}%).\n`
      })
    }

    md += `\n### 2. Dự báo nguy cơ trong thời gian tới:\n`
    if (!hasDangerOrWarning) {
      md += `- Hiện tại chưa phát hiện nguy cơ sạt lở đáng kể do độ ẩm đất và lượng mưa trong ngưỡng an toàn.\n`
    } else {
      const worst = rows[0]
      const worstName = worst.location_name || worst.province || 'các khu vực đồi núi dốc'
      md += `- ⚠️ Cảnh báo sạt lở tại các sườn dốc thuộc khu vực **${worstName}** do đất đã bão hòa nước (API 14 ngày vượt ngưỡng hoặc mưa lớn kéo dài).\n`
    }

    md += `\n### 3. ⚠️ Khuyến cáo an toàn:\n`
    md += `- Hạn chế di chuyển qua các tuyến đường sát sườn dốc, bờ sông có độ dốc cao.\n`
    md += `💡 _Hỏi thêm: "Khu vực nguy hiểm nhất" để xem chi tiết._`

    return md
  }

  /**
   * Intent 2: Khu vực nguy hiểm nhất (Top 5 hotspots)
   */
  async queryWorstArea() {
    try {
      const cacheStats = landslideCache.getStats()
      if (cacheStats.ready) {
        const topIds = landslideCache.scanTop(5)
        if (topIds.length > 0) {
          return this.getNodesDetails(topIds)
        }
        return []
      }

      // Fallback: Query DB
      const sql = `
        SELECT sub.node_id, sub.prob_landslide, sub.risk_level, sub.prediction_time,
               gn.location_name, gn.province, gn.lat, gn.lon, gn.slope, gn.elevation
        FROM (
          SELECT DISTINCT ON (node_id) *
          FROM landslide_predictions
          WHERE prediction_time >= NOW() - INTERVAL '4 hours'
          ORDER BY node_id, prob_landslide DESC, prediction_time DESC
        ) sub
        JOIN landslide_grid_nodes gn ON gn.node_id = sub.node_id
        ORDER BY sub.prob_landslide DESC
        LIMIT 5
      `
      const { rows } = await this.withTimeout(this.pool.query(sql))
      return rows
    } catch (err) {
      console.error('[LandslideService][queryWorstArea] Lỗi:', err.message)
      return []
    }
  }

  formatWorstArea(rows) {
    if (!rows || rows.length === 0) {
      return {
        text: `✅ Trong 4 ngày tới, không có khu vực nào ở mức nguy cơ cao hoặc nghiêm trọng.`,
        expertNodes: []
      }
    }

    let text = `🚨 **Danh sách các khu vực có nguy cơ sạt lở cao nhất:**\n\n`
    const expertNodes = []

    rows.forEach((r, idx) => {
      const name = r.location_name || `Khu vực tại (${safeNumber(r.lat, 4)}°N, ${safeNumber(r.lon, 4)}°E)`
      const probPercent = (Number(r.prob_landslide || 0) * 100).toFixed(1)
      const levelEmoji = r.risk_level === 'DANGER' ? '🔴 Rất cao' : '🟡 Cao'
      text += `**${idx + 1}.** ${name}\n`
      text += `   - Mức nguy cơ: **${levelEmoji}** (Xác suất: **${probPercent}%**)\n`
      text += `   - Độ dốc: **${safeNumber(r.slope, 1)}°** | Cao độ: **${safeNumber(r.elevation, 0)}m**\n\n`

      expertNodes.push({
        node_id: r.node_id,
        location_name: name,
        risk_level: r.risk_level === 'DANGER' ? 'severe' : 'high'
      })
    })

    text += `💡 *Chọn hoặc click các gợi ý dưới đây để xem giải thích chi tiết vì sao các khu vực này nguy hiểm.*`

    return {
      text,
      expertNodes
    }
  }

  /**
   * Intent 3: Giải thích cơ bản (Vì sao khu vực [X] có nguy cơ sạt lở?)
   */
  async queryNodeByKeyword(keyword) {
    try {
      // 1. Tìm node_id từ grid_nodes trước (tránh full join scan)
      const sqlNode = `
        SELECT node_id, location_name, province, lat as latitude, lon as longitude, elevation, slope, dist_to_river_m, dist_to_road_m, ndvi, bsi, tpi
        FROM landslide_grid_nodes
        WHERE location_name ILIKE $1 OR province ILIKE $1
        LIMIT 1
      `
      const { rows: nodeRows } = await this.withTimeout(this.pool.query(sqlNode, [`%${keyword}%`]))
      if (nodeRows.length === 0) return null

      const node = nodeRows[0]

      // 2. Query prediction của node đó
      const sqlPred = `
        SELECT *
        FROM landslide_predictions
        WHERE node_id = $1
        ORDER BY prediction_time DESC
        LIMIT 1
      `
      const { rows: predRows } = await this.pool.query(sqlPred, [node.node_id])
      if (predRows.length === 0) return node

      return { ...node, ...predRows[0] }
    } catch (err) {
      console.error('[LandslideService][queryNodeByKeyword] Lỗi:', err.message)
      return null
    }
  }

  async queryNodeById(nodeId) {
    try {
      if (!nodeId || typeof nodeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
        return null
      }
      const sqlNode = `
        SELECT node_id, location_name, province, lat as latitude, lon as longitude, elevation, slope, dist_to_river_m, dist_to_road_m, ndvi, bsi, tpi
        FROM landslide_grid_nodes
        WHERE node_id = $1
        LIMIT 1
      `
      const { rows: nodeRows } = await this.withTimeout(this.pool.query(sqlNode, [nodeId]))
      if (nodeRows.length === 0) return null

      const node = nodeRows[0]

      const sqlPred = `
        SELECT *
        FROM landslide_predictions
        WHERE node_id = $1
        ORDER BY prediction_time DESC
        LIMIT 1
      `
      const { rows: predRows } = await this.pool.query(sqlPred, [node.node_id])
      if (predRows.length === 0) return node

      return { ...node, ...predRows[0] }
    } catch (err) {
      console.error('[LandslideService][queryNodeById] Lỗi:', err.message)
      return null
    }
  }

  async formatExplainRisk(nodeData) {
    try {
      if (!nodeData) return '🔍 Không tìm thấy dữ liệu sạt lở cho khu vực này.'

      // Đảm bảo có model ONNX
      const runResult = await onnxRunner.predictLandslideForChatbot(nodeData)
      const importance = runResult.featureImportance

      const riskScore = computeLandslideRiskScore(nodeData)
      const riskLabel = getRiskTextLabel(riskScore)

      const locationName = nodeData.location_name || `Khu vực tại (${safeNumber(nodeData.latitude, 4)}°N, ${safeNumber(nodeData.longitude, 4)}°E)`
      const node_id = nodeData.node_id

      const api7 = safeNumber(nodeData.api_7d, 1)
      const slope = safeNumber(nodeData.slope, 1)
      const soil7 = safeNumber(nodeData.soil_moisture_7d || nodeData.soil_moisture_1d, 3)
      const ndvi = safeNumber(nodeData.ndvi, 2)
      const distRoad = safeNumber(nodeData.dist_to_road_m, 0)
      const distRiver = safeNumber(nodeData.dist_to_river_m, 0)

      const api7Comment = Number(api7) >= 80 ? 'đất đã bão hòa nước và cực kỳ kém ổn định' : 'ở mức tương đối an toàn'
      const slopeComment = Number(slope) >= 25 ? 'địa hình rất dốc dễ sạt lở khi mưa lớn' : 'địa hình thoải ít nguy hiểm sạt tự nhiên'
      const ndviComment = Number(ndvi) <= 0.4 ? 'thảm thực vật thưa thớt, khả năng giữ đất kém' : 'che phủ thực vật tốt giúp giữ đất'

      let md = `📍 Phân tích nguy cơ sạt lở – ${locationName}\n`
      md += `⚡ Đánh giá nhanh:\n`
      md += `- Mức nguy cơ sạt lở: **${riskLabel}**\n`
      md += `- Điểm rủi ro: **${riskScore}/10** ⚠️\n\n`

      md += `❓ Vì sao khu vực này có nguy cơ sạt lở?\n`
      md += `1. 🌧️ Mưa tích lũy (API 7 ngày): Đạt **${api7} mm**, ${api7Comment}.\n`
      md += `2. ⛰️ Độ dốc (Slope): **${slope}°**, ${slopeComment}.\n`
      md += `3. 💧 Độ ẩm đất (7 ngày): **${soil7} m³/m³**.\n`
      md += `4. 🌿 Thảm thực vật (NDVI): **${ndvi}**, ${ndviComment}.\n`
      md += `5. 🛣️ Giao thông / Thủy văn: Cách đường **${distRoad}m**, cách sông **${distRiver}m**.\n\n`

      md += `🔍 Phân tích chuyên sâu:\n`
      // 1. Nhóm mưa & ẩm
      md += `1. ☔ *Nhóm yếu tố mưa & ẩm:* `
      if (Number(nodeData.api_7d) >= 60) {
        md += `Lượng mưa tích lũy dài ngày đang làm yếu kết cấu liên kết của đất sườn dốc, tạo áp lực nước lỗ rỗng lớn dẫn đến trượt lở.\n`
      } else {
        md += `Lượng mưa gần đây không quá cao, tuy nhiên cần chú ý nếu xuất hiện mưa lớn cục bộ.\n`
      }

      // 2. Nhóm địa hình
      md += `2. 📉 *Nhóm yếu tố địa hình:* `
      if (Number(nodeData.slope) >= 20) {
        md += `Độ dốc kết hợp với lực hấp dẫn tạo ra ứng suất trượt lớn lên các khối đất đá trên sườn dốc.\n`
      } else {
        md += `Độ dốc tương đối an toàn cho các hoạt động xây dựng bình thường.\n`
      }

      // 3. Nhóm lớp phủ
      md += `3. 🌲 *Nhóm yếu tố lớp phủ:* `
      if (Number(nodeData.ndvi) <= 0.45) {
        md += `Thiếu rễ cây xanh giữ đất và cản dòng chảy mặt khi mưa lớn, thúc đẩy xói mòn và trượt lở đất.\n`
      } else {
        md += `Hệ thực vật che phủ tương đối dày hỗ trợ giữ đất và thoát nước bề mặt tốt.\n\n`
      }

      // Top 1 Feature từ ONNX
      const topFeature = importance[0]
      md += `📌 Kết luận: Khu vực **${locationName}** có nguy cơ sạt lở chủ yếu do **${topFeature.displayName}** (tác động lớn nhất với ${topFeature.importance}%).\n`

      return {
        text: md,
        actionButton: {
          label: '🔬 Phân tích chuyên gia',
          payload: `EXPLAIN_LANDSLIDE_AI_DEEP|${node_id}`
        }
      }
    } catch (err) {
      console.error('[LandslideService][formatExplainRisk] Lỗi:', err.message)
      return {
        text: 'Hiện tại hệ thống cảnh báo sạt lở đang cập nhật dữ liệu. Vui lòng thử lại sau ít phút.',
        actionButton: null
      }
    }
  }

  /**
   * Intent 4: Phân tích chuyên gia
   */
  async formatExpertAnalysis(nodeData) {
    try {
      if (!nodeData) return '🔍 Không tìm thấy dữ liệu sạt lở cho khu vực này.'

      const runResult = await onnxRunner.predictLandslideForChatbot(nodeData)
      const importance = runResult.featureImportance

      const probPercent = (runResult.probability * 100).toFixed(1)
      const riskLevel = runResult.risk_level
      const riskTag = riskLevel === 'DANGER' ? 'RẤT CAO 🔴' : 'AN TOÀN 🟢'
      const warningText = riskLevel === 'DANGER' ? 'Cảnh báo nguy cơ trượt lở đất sườn dốc' : 'Khu vực an toàn'

      const top1 = importance[0]
      const locationName = nodeData.location_name || `Khu vực tại (${safeNumber(nodeData.latitude, 4)}°N, ${safeNumber(nodeData.longitude, 4)}°E)`

      let md = `> 🔬 Phân tích chuyên gia – Sạt Lở Node ${nodeData.node_id}\n`
      md += `> 🛡️ Mức rủi ro sạt lở: **${riskTag}**\n`
      md += `>\n`
      md += `> 🧠 Mô hình CatBoost/ONNX dự báo xác suất: **${probPercent}%** ➡️ **${warningText}**\n`
      md += `>\n`
      md += `> ⚠️ Các yếu tố nguy cơ chính (Feature Importance):\n`
      md += `> 1. **${top1.displayName}** (${safeNumber(top1.value, 1)}${top1.unit}) tác động lớn nhất (${top1.importance}%).\n`
      md += `>\n`
      md += `> 📊 Dữ liệu chi tiết tại thời điểm phân tích:\n`
      md += `>\n`
      md += `> | 🗂️ Nhóm | 📝 Chỉ số | 🔢 Giá trị |\n`
      md += `> |---|---|---|\n`
      md += `> | 🌧️ Lượng mưa | Mưa 1 ngày | ${safeNumber(nodeData.rain_1d_accum, 1)} mm |\n`
      md += `> | | Mưa 7 ngày | ${safeNumber(nodeData.rain_7d_accum, 1)} mm |\n`
      md += `> | | API 7 ngày | ${safeNumber(nodeData.api_7d, 1)} |\n`
      md += `> | ⛰️ Địa hình | Cao độ | ${safeNumber(nodeData.elevation, 0)} m |\n`
      md += `> | | Độ dốc (Slope) | ${safeNumber(nodeData.slope, 1)}° |\n`
      md += `> | | TPI (Vị trí) | ${safeNumber(nodeData.tpi, 2)} m |\n`
      md += `> | 🌱 Lớp phủ & Đất | Độ ẩm đất 1d | ${safeNumber(nodeData.soil_moisture_1d, 3)} |\n`
      md += `> | | NDVI | ${safeNumber(nodeData.ndvi, 2)} |\n`
      md += `> | | BSI (Đất trống) | ${safeNumber(nodeData.bsi, 2)} |\n`
      md += `> | 🛣️ Khác | Cách đường | ${safeNumber(nodeData.dist_to_road_m, 0)} m |\n`
      md += `> | | Cách sông | ${safeNumber(nodeData.dist_to_river_m, 0)} m |\n`
      md += `>\n`
      md += `> 💡 Khuyến nghị:\n`

      if (riskLevel === 'DANGER') {
        md += `> Tuyệt đối không đến gần khu vực sườn dốc nguy hiểm khi trời mưa bão lớn, di dời người và tài sản khỏi vùng có dấu hiệu nứt đất sườn núi.\n`
      } else {
        md += `> An toàn, có thể sinh hoạt bình thường. Tiếp tục duy trì thảm che phủ cây xanh tự nhiên.\n`
      }
      md += `>\n`
      md += `> *--- Phân tích bằng mô hình AI 🧠 + dữ liệu Vệ tinh (SMAP/MODIS).*`

      return md
    } catch (err) {
      console.error('[LandslideService][formatExpertAnalysis] Lỗi:', err.message)
      return 'Hiện tại hệ thống cảnh báo sạt lở đang cập nhật dữ liệu. Vui lòng thử lại sau ít phút.'
    }
  }
}

module.exports = new LandslideChatbotService()
