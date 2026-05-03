const {
  getLatestNodeDataByKeyword,
  getMostDangerousNode,
  getCurrentFloodOverview,
} = require('../services/chatbotDb.service')

function extractKeyword(question) {
  return question
    .replace(/vì sao/gi, '')
    .replace(/tại sao/gi, '')
    .replace(/khu vực/gi, '')
    .replace(/ngập/gi, '')
    .replace(/nguy cơ/gi, '')
    .replace(/cao/gi, '')
    .replace(/hiện tại/gi, '')
    .replace(/[?.!,]/g, '')
    .trim()
}

function normalizeRiskLevel(riskLevel, floodDepthCm) {
  if (riskLevel) return String(riskLevel)

  const depth = Number(floodDepthCm ?? 0)

  if (depth >= 30) return 'high'
  if (depth >= 10) return 'medium'
  return 'low'
}

function buildReasonList(data) {
  const f = data.safe_features
  const reasons = []

  if (f.prcp_24h >= 100) {
    reasons.push(`Mưa tích lũy 24h cao: **${f.prcp_24h} mm**`)
  }

  if (f.prcp_6h >= 60) {
    reasons.push(`Mưa 6h gần đây lớn: **${f.prcp_6h} mm**`)
  }

  if (f.max_prcp_3h >= 30) {
    reasons.push(`Cường độ mưa cực đại 3h cao: **${f.max_prcp_3h} mm**`)
  }

  if (f.elevation <= 1.5) {
    reasons.push(`Cao độ địa hình thấp: **${f.elevation} m**`)
  }

  if (f.slope <= 1) {
    reasons.push(`Độ dốc nhỏ: **${f.slope}**, nước khó thoát nhanh`)
  }

  if (f.impervious_ratio >= 0.7) {
    reasons.push(`Tỷ lệ bê tông hóa cao: **${f.impervious_ratio}**, khả năng thấm nước thấp`)
  }

  if (f.dist_to_drain_km <= 0.3) {
    reasons.push(`Gần hệ thống thoát nước: **${f.dist_to_drain_km} km**, dễ quá tải khi mưa lớn`)
  }

  if (f.dist_to_river_km <= 0.5) {
    reasons.push(`Gần sông/kênh rạch: **${f.dist_to_river_km} km**, có thể chịu ảnh hưởng mực nước`)
  }

  if (f.rainy_season_flag === 1) {
    reasons.push(`Đang trong mùa mưa, xác suất ngập tăng`)
  }

  return reasons
}

function buildAreaAnswer(data) {
  if (!data) {
    return 'Tôi chưa tìm thấy dữ liệu khu vực này trong database Aiven. Bạn hãy thử nhập tên khu vực, `location_name`, `grid_id` hoặc `node_id`.'
  }

  const f = data.safe_features
  const riskLevel = normalizeRiskLevel(data.risk_level, data.flood_depth_cm)
  const floodDepth = Number(data.flood_depth_cm ?? 0)

  const reasons = buildReasonList(data)

  const reasonText = reasons.length
    ? reasons.map((r) => `- ${r}`).join('\n')
    : '- Chưa có yếu tố nào vượt ngưỡng mạnh, nhưng hệ thống vẫn dự báo dựa trên tổ hợp 30 biến đầu vào.'

  return `
Khu vực **${data.location_name || `node_id ${data.node_id}`}** hiện được đánh giá mức rủi ro: **${riskLevel}**.

Độ sâu ngập dự báo: **${floodDepth.toFixed(2)} cm**.

Các nguyên nhân chính:
${reasonText}

Nhóm biến đầu vào model đang sử dụng gồm:

**1. Nhóm mưa/thời tiết**
- prcp=${f.prcp}
- prcp_3h=${f.prcp_3h}
- prcp_6h=${f.prcp_6h}
- prcp_12h=${f.prcp_12h}
- prcp_24h=${f.prcp_24h}
- temp=${f.temp}
- rhum=${f.rhum}
- wspd=${f.wspd}
- pres=${f.pres}
- pressure_change_24h=${f.pressure_change_24h}

**2. Nhóm địa hình/hạ tầng**
- elevation=${f.elevation}
- slope=${f.slope}
- impervious_ratio=${f.impervious_ratio}
- dist_to_drain_km=${f.dist_to_drain_km}
- dist_to_river_km=${f.dist_to_river_km}
- dist_to_pump_km=${f.dist_to_pump_km}
- dist_to_main_road_km=${f.dist_to_main_road_km}
- dist_to_park_km=${f.dist_to_park_km}

**3. Nhóm thời gian**
- hour=${f.hour}
- dayofweek=${f.dayofweek}
- month=${f.month}
- dayofyear=${f.dayofyear}
- rainy_season_flag=${f.rainy_season_flag}

Kết luận: model không chỉ dựa vào lượng mưa, mà kết hợp cả mưa tích lũy, địa hình, bề mặt đô thị, khoảng cách tới hệ thống thoát nước/sông/trạm bơm và yếu tố thời gian để đưa ra dự báo.
`.trim()
}

async function askChatbot(req, res, next) {
  try {
    const { question, message } = req.body
    const userQuestion = question || message

    if (!userQuestion) {
      return res.status(400).json({
        success: false,
        error: { message: 'Thiếu câu hỏi từ người dùng.' },
      })
    }

    const lower = userQuestion.toLowerCase()
    let answer = ''
    let rawData = null

    if (
      lower.includes('khu vực nguy hiểm nhất') ||
      lower.includes('nguy hiểm nhất') ||
      lower.includes('ngập nặng nhất')
    ) {
      rawData = await getMostDangerousNode()
      answer = buildAreaAnswer(rawData)
    } else if (
      lower.includes('tình trạng ngập hiện tại') ||
      lower.includes('hiện tại') ||
      lower.includes('danh sách ngập')
    ) {
      const rows = await getCurrentFloodOverview()

      if (!rows.length) {
        answer = 'Hiện chưa có dữ liệu dự báo ngập trong bảng flood_predictions.'
      } else {
        answer = rows.map((r, index) => {
          return `${index + 1}. **${r.location_name || `node_id ${r.node_id}`}**: depth=${Number(r.flood_depth_cm || 0).toFixed(2)} cm, risk=${r.risk_level || 'N/A'}, mưa 24h=${r.prcp_24h || 0} mm`
        }).join('\n')
      }
    } else {
      const keyword = extractKeyword(userQuestion)
      rawData = await getLatestNodeDataByKeyword(keyword)
      const modelResult = await predictFloodByFeatures(rawData.safe_features)
      answer = buildAreaAnswer(rawData)
    }

    return res.json({
      success: true,
      data: {
        answer,
        raw_data: rawData,
      },
    })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  askChatbot,
}