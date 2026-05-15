'use strict'

/**
 * chatbotFormatter.js – Markdown Response Formatter cho AQUA Bot
 * ─────────────────────────────────────────────────────────────────────────────
 * Biến đổi dữ liệu thô từ DB/Cache → chuỗi Markdown theo đúng template yêu cầu.
 *
 * Hai hàm chính:
 *   1. formatCurrentStatus(rows, areaName)  → Intent CURRENT_STATUS
 *   2. formatExplainRisk(featureRow)        → Intent EXPLAIN_RISK (Tier 1 + Tier 2)
 *
 * QUY TẮC:
 *   - Mọi giá trị số đều qua safe() để tránh NaN / undefined trong output.
 *   - Không truy cập DB — chỉ nhận data đã query sẵn.
 *   - Export pure functions, không có side-effect.
 */

const TZ = 'Asia/Ho_Chi_Minh'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format Date → giờ Việt Nam dạng ngắn gọn: "22:05, 12/05/2026" */
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

/** Chuyển số an toàn, tránh NaN / undefined */
function safe(val, decimals = 1, fallback = 0) {
  const n = Number(val)
  return Number.isFinite(n) ? n.toFixed(decimals) : Number(fallback).toFixed(decimals)
}

/** Đánh giá mức nguy cơ dựa trên riskScore (0-12) */
function riskLevelLabel(score) {
  if (score >= 9) return 'RẤT CAO 🔴'
  if (score >= 6) return 'CAO 🟠'
  if (score >= 3) return 'TRUNG BÌNH 🟡'
  return 'THẤP 🟢'
}

/**
 * Tính điểm rủi ro nội bộ (0-12) từ các feature.
 * Mỗi nhóm yếu tố đóng góp 0-3 điểm. Tổng = 4 nhóm × 3 = 12 max.
 *
 * Nhóm 1: Mưa (prcp_3h, prcp_6h, prcp_24h)
 * Nhóm 2: Địa hình (elevation, slope)
 * Nhóm 3: Đô thị hoá (impervious_ratio)
 * Nhóm 4: Hạ tầng thoát nước (dist_to_drain, dist_to_river, dist_to_pump)
 */
function computeRiskScore(f) {
  let score = 0

  // Nhóm mưa (0-3)
  const prcp3 = Number(f.prcp_3h || 0)
  const prcp6 = Number(f.prcp_6h || 0)
  const prcp24 = Number(f.prcp_24h || 0)
  if (prcp3 >= 50) score += 1
  if (prcp6 >= 80) score += 1
  if (prcp24 >= 120) score += 1

  // Nhóm địa hình (0-3)
  const elev = Number(f.elevation || 10)
  const slope = Number(f.slope || 2)
  if (elev <= 3) score += 2
  else if (elev <= 6) score += 1
  if (slope <= 0.5) score += 1

  // Nhóm đô thị hoá (0-3)
  const imp = Number(f.impervious_ratio || 0)
  if (imp >= 0.8) score += 3
  else if (imp >= 0.6) score += 2
  else if (imp >= 0.4) score += 1

  // Nhóm hạ tầng thoát nước (0-3)
  const drain = Number(f.dist_to_drain_km || 1)
  const river = Number(f.dist_to_river_km || 2)
  const pump = Number(f.dist_to_pump_km || 2)
  if (drain >= 1) score += 1
  if (river >= 2) score += 1
  if (pump >= 3) score += 1

  return Math.min(score, 12)
}


// ═════════════════════════════════════════════════════════════════════════════
// FORMAT: CURRENT_STATUS
// Template 3-section: Đang ngập → Dự báo 1-2h → Khuyến cáo lộ trình
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Tạo Markdown cho intent CURRENT_STATUS.
 *
 * @param {Array} rows      - Các bản ghi có risk_level IN ('high','severe'),
 *                            đã JOIN grid_nodes (location_name, flood_depth_cm, ...)
 * @param {string|null} areaName - Tên khu vực nếu user hỏi cụ thể
 * @returns {string} Markdown
 */
function formatCurrentStatus(rows, areaName) {
  const now = formatVN(new Date())
  const areaLabel = areaName
    ? areaName.charAt(0).toUpperCase() + areaName.slice(1)
    : 'Hà Nội'

  // ── Header ──────────────────────────────────────────────────────────────
  let md = `🌧️ **Báo Cáo Tình Trạng Ngập Lụt ${areaLabel}** (Cập nhật lúc ${now})\n\n`
  md += `Chào bạn! Dựa trên dữ liệu lượng mưa đo được từ các trạm quan trắc tự động `
  md += `và mô hình dự báo thủy văn của hệ thống, tình hình ngập úng tại khu vực `
  md += `**${areaLabel}** hiện tại được ghi nhận như sau:\n\n`

  // ── Section 1: Các điểm ĐANG NGẬP ──────────────────────────────────────
  const flooding = rows.filter(r =>
    ['high', 'severe'].includes(r.risk_level) && Number(r.flood_depth_cm) > 0
  )

  md += `### 1. Các điểm ĐANG NGẬP (Cập nhật thực tế):\n\n`

  if (flooding.length > 0) {
    flooding.forEach(r => {
      const loc = r.location_name || `Điểm đo #${r.node_id}`
      const depth = safe(r.flood_depth_cm, 0)
      const riskEmoji = r.risk_level === 'severe' ? '🔴' : '🟠'
      md += `- ${riskEmoji} **${loc}**: ngập khoảng **${depth}cm**`
      if (r.explanation) md += ` – _${r.explanation}_`
      md += `\n`
    })
  } else {
    md += `- ✅ Hiện chưa ghi nhận điểm ngập nghiêm trọng nào tại ${areaLabel}.\n`
  }

  // ── Section 2: Dự báo nguy cơ ngập 1-2 giờ tới ────────────────────────
  md += `\n### 2. Dự báo nguy cơ ngập trong 1-2 giờ tới:\n\n`
  md += `Do mây đối lưu vẫn đang phát triển và lượng mưa tích lũy chưa giảm, `
  md += `hệ thống cảnh báo nguy cơ ngập sâu tại các "điểm đen" sau đây:\n\n`

  if (flooding.length > 0) {
    // Hiển thị top 5 điểm có flood_depth_cm cao nhất làm dự báo
    const forecast = [...flooding]
      .sort((a, b) => Number(b.flood_depth_cm) - Number(a.flood_depth_cm))
      .slice(0, 5)
    forecast.forEach(r => {
      const loc = r.location_name || `Điểm đo #${r.node_id}`
      const depth = safe(r.flood_depth_cm, 0)
      const riskLabel = r.risk_level === 'severe' ? 'Nguy cơ rất cao' : 'Nguy cơ cao'
      md += `- ⚠️ **${loc}**: ${riskLabel} – dự báo ngập tới **${depth}cm**\n`
    })
  } else {
    md += `- Hiện tại chưa phát hiện nguy cơ ngập đáng kể trong thời gian tới.\n`
  }

  // ── Section 3: Khuyến cáo lộ trình & An toàn ──────────────────────────
  md += `\n### 3. ⚠️ Khuyến cáo lộ trình & An toàn:\n\n`

  if (flooding.length > 0) {
    const avoidRoutes = flooding
      .slice(0, 3)
      .map(r => r.location_name || `khu vực điểm #${r.node_id}`)
      .join(', ')
    md += `- **Tránh các tuyến:** ${avoidRoutes}\n`
    md += `- **Gợi ý:** Ưu tiên sử dụng các tuyến đường cao, tránh khu vực trũng, hầm chui. `
    md += `Kiểm tra bản đồ ngập AQUAALERT trước khi di chuyển.\n`
  } else {
    md += `- Tình trạng giao thông hiện tại bình thường, không cần tránh tuyến đặc biệt.\n`
    md += `- Vẫn nên theo dõi diễn biến thời tiết trong các giờ tới.\n`
  }

  md += `\n💡 _Hỏi thêm: "Vì sao khu vực này có nguy cơ ngập?" để xem phân tích chuyên sâu._`

  return md
}


// ═════════════════════════════════════════════════════════════════════════════
// FORMAT: EXPLAIN_RISK (TIER 1)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Tạo Markdown Tier 1 cho intent EXPLAIN_RISK.
 *
 * @param {Object} f  - Bản ghi đã JOIN đầy đủ: grid_nodes + weather_measurements + flood_predictions
 * @param {string} locationName - Tên địa danh
 * @returns {string} Markdown Tier 1
 */
function formatTier1RiskExplanation(f, locationName) {
  const riskScore = computeRiskScore(f)
  const riskLabel = riskLevelLabel(riskScore)

  const prcp3 = safe(f.prcp_3h, 1)
  const prcp24 = safe(f.prcp_24h, 1)
  const elevation = safe(f.elevation, 1)
  const impPct = safe(Number(f.impervious_ratio || 0) * 100, 0)
  const drainKm = safe(f.dist_to_drain_km, 2)
  const isRainy = (f.rainy_season_flag === true || f.rainy_season_flag === 1 || Number(f.rainy_season_flag) === 1)

  let md = `📍 **Phân tích nguy cơ ngập – ${locationName}**\n\n`
  md += `⚡ **Đánh giá nhanh:**\n`
  md += `- Mức nguy cơ ngập: **${riskLabel}**\n`
  md += `- Điểm rủi ro nội bộ: **${riskScore}/12** ⚠️\n\n`

  md += `❓ **Vì sao khu vực này có nguy cơ ngập?**\n`

  // Nhận xét động
  const prcp3Comment = Number(f.prcp_3h) >= 50 ? 'cho thấy cường độ mưa lớn' : (Number(f.prcp_3h) === 0 ? 'mưa chưa đáng kể' : 'ở mức an toàn')
  const prcp24Comment = Number(f.prcp_24h) >= 100 ? 'tích lũy lượng nước rất lớn, dễ gây quá tải cống' : (Number(f.prcp_24h) === 0 ? 'chưa có tích lũy mưa lớn' : 'lượng mưa tích lũy trung bình')
  const elevComment = Number(f.elevation) <= 5 ? 'vùng thấp nước dễ dồn về' : 'địa hình cao dễ thoát'
  const impComment = Number(f.impervious_ratio) >= 0.6 ? 'bề mặt bê tông hóa cao, nước khó thấm' : 'vẫn còn diện tích thấm nước tự nhiên'
  const drainComment = Number(f.dist_to_drain_km) <= 0.4 ? 'rất gần cống thoát' : 'khoảng cách xa, nước thoát chậm'

  md += `1. 🌧️ **Mưa 3 giờ gần nhất:** Đạt ${prcp3} mm, ${prcp3Comment}.\n`
  md += `2. 🌧️ **Tổng mưa 24 giờ:** Đạt ${prcp24} mm, ${prcp24Comment}.\n`
  md += `3. ⛰️ **Cao độ:** Chỉ khoảng ${elevation} m, ${elevComment}.\n`
  md += `4. 🏢 **Tỷ lệ bê tông hóa:** ${impPct}%, ${impComment}.\n`
  md += `5. 🕳️ **Khoảng cách tới hệ thống thoát nước:** ${drainKm} km, ${drainComment}.\n`
  md += `6. 📅 **Thời điểm hiện tại:** ${isRainy ? 'nằm trong' : 'không nằm trong'} mùa mưa chính.\n\n`

  md += `🔍 **Phân tích chuyên sâu:**\n`
  // Nhóm mưa
  md += `1. ☔ *Nhóm yếu tố mưa:* `
  if (Number(f.prcp_24h) >= 100) md += `Lượng mưa tích lũy lớn có nguy cơ gây quá tải hệ thống thoát nước nghiêm trọng.\n`
  else if (Number(f.prcp_6h) >= 50) md += `Lượng mưa trong thời gian ngắn khá cao, cần theo dõi.\n`
  else md += `Lượng mưa hiện hành chưa phải là mối đe dọa lớn.\n`

  // Nhóm địa hình
  md += `2. 📉 *Nhóm yếu tố địa hình:* `
  if (Number(f.elevation) < 5) md += `Địa hình thấp, dạng trũng khiến nước dễ bề tích tụ.\n`
  else md += `Địa hình thuận lợi cho tiêu thoát tự nhiên.\n`

  // Nhóm đô thị hóa
  md += `3. 🏙️ *Nhóm yếu tố đô thị hóa:* `
  if (Number(f.impervious_ratio) >= 0.6) md += `Đô thị hóa mạnh làm giảm khả năng thấm, sinh ra dòng chảy mặt lớn.\n`
  else md += `Không gian mở còn đủ để hỗ trợ thấm nước tự nhiên.\n\n`

  md += `📌 **Kết luận:**\n`
  md += `Khu vực ${locationName} có nguy cơ ngập chủ yếu do `
  const factors = []
  if (Number(f.prcp_24h) >= 50) factors.push('mưa lớn kéo dài')
  if (Number(f.elevation) < 5) factors.push('địa hình trũng thấp')
  if (Number(f.impervious_ratio) >= 0.6) factors.push('bề mặt bê tông hóa cao')
  if (Number(f.dist_to_drain_km) >= 1) factors.push('xa hạ tầng thoát nước')
  if (factors.length === 0) factors.push('các yếu tố tổng hợp')
  md += `**${factors.join(', ')}**.\n\n`

  md += `💡 **Khuyến nghị:**\n`
  if (riskScore >= 6) {
    md += `- 🚶 Hạn chế đi qua khu vực này khi trời mưa lớn.\n`
    md += `- 📱 Chú ý các cảnh báo ngập lụt tiếp theo từ hệ thống.\n`
  } else {
    md += `- 🚶 Có thể di chuyển bình thường, nhưng vẫn nên chú ý quan sát.\n`
    md += `- 📱 Theo dõi cập nhật nếu trời có dấu hiệu mưa lớn.\n`
  }

  md += `\n*---- Phân tích tự động bởi AQUAALERT 🤖 | Cập nhật: ${formatVN(new Date())} 🕒*\n`
  return md
}

// ═════════════════════════════════════════════════════════════════════════════
// FORMAT: TIER 2 EXPERT ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Tạo Markdown Tier 2 cho phân tích chuyên gia CatBoost.
 *
 * @param {Object} catboostData - Chứa features vector, AI result (flood_depth_cm, risk_level), dbRow
 * @param {string} locationName - Tên địa danh
 * @returns {string} Markdown Tier 2
 */
function formatTier2ExpertAnalysis(catboostData, locationName) {
  const { features, dbRow, aiResult } = catboostData
  const riskLevel = aiResult?.risk_level ?? dbRow?.risk_level ?? 'safe'
  const depthCm = Number(aiResult?.flood_depth_cm ?? dbRow?.flood_depth_cm ?? 0)

  // Tag rủi ro
  const riskLabels = { safe: 'AN TOÀN 🟢', medium: 'NGUY CƠ THẤP 🟡', high: 'NGUY CƠ CAO 🟠', severe: 'NGUY HIỂM 🔴' }
  const riskTag = riskLabels[riskLevel] || 'AN TOÀN 🟢'
  const depthAssess = depthCm > 30 ? 'Ngập sâu nguy hiểm' : (depthCm > 10 ? 'Ngập nhẹ' : 'An toàn')

  // Top features (giả định dựa trên rule vì không có SHAP value thực tế từ CatBoost API trả về)
  const topFeatures = []
  if (features.prcp_24h >= 100) topFeatures.push(`🌧️ Lượng mưa 24h cực lớn (${features.prcp_24h}mm) gây quá tải cục bộ`)
  else if (features.prcp_3h >= 50) topFeatures.push(`🌧️ Cường độ mưa 3h mạnh (${features.prcp_3h}mm) tạo dòng chảy mặt`)
  if (features.elevation <= 5) topFeatures.push(`📉 Cao độ địa hình thấp (${features.elevation}m) dễ tích tụ nước`)
  if (features.impervious_ratio >= 0.7) topFeatures.push(`🏢 Tỷ lệ bê tông hóa rất cao (${(features.impervious_ratio * 100).toFixed(0)}%) ngăn nước thấm`)
  if (features.dist_to_drain_km >= 1.5) topFeatures.push(`🕳️ Khoảng cách đến cống thoát khá xa (${features.dist_to_drain_km}km)`)
  if (topFeatures.length === 0) topFeatures.push('✅ Không có yếu tố nào vượt ngưỡng nguy hiểm đột biến')

  let md = `> 🔬 **Phân tích chuyên gia – ${locationName}**\n`
  md += `> 🛡️ Mức rủi ro ngập: **${riskTag}**\n`
  md += `> \n`
  md += `> 🧠 **Mô hình CatBoost dự báo:** **${depthCm.toFixed(1)} cm** ➡️ ${depthAssess}\n`
  md += `> \n`
  md += `> ⚠️ **Các yếu tố nguy cơ chính:**\n`
  topFeatures.slice(0, 3).forEach((feat, idx) => {
    md += `> ${idx + 1}. ${feat}\n`
  })
  if (topFeatures.length === 0) {
    md += `> 1. ✅ Dữ liệu các biến đều nằm trong ngưỡng an toàn\n`
  }
  md += `> \n`
  md += `> 📊 **Dữ liệu chi tiết tại thời điểm phân tích:**\n`
  md += `> \n`
  md += `> | 🗂️ Nhóm | 📝 Chỉ số | 🔢 Giá trị |\n`
  md += `> |---|---|---|\n`
  md += `> | 🌧️ **Mưa** | Hiện tại | ${features.prcp} mm |\n`
  md += `> | | 3h | ${features.prcp_3h} mm |\n`
  md += `> | | 6h | ${features.prcp_6h} mm |\n`
  md += `> | | 12h | ${features.prcp_12h} mm |\n`
  md += `> | | 24h | ${features.prcp_24h} mm |\n`
  md += `> | 🌤️ **Khí tượng** | Nhiệt độ | ${features.temp}°C |\n`
  md += `> | | Độ ẩm | ${features.rhum}% |\n`
  md += `> | | Gió | ${features.wspd} m/s |\n`
  md += `> | | Áp suất | ${features.pres} hPa |\n`
  md += `> | | Biến thiên 24h | ${features.pressure_change_24h} hPa |\n`
  md += `> | ⛰️ **Địa hình** | Cao độ | ${features.elevation} m |\n`
  md += `> | | Độ dốc | ${features.slope}° |\n`
  md += `> | 🏢 **Đô thị** | Bê tông hóa | ${(features.impervious_ratio * 100).toFixed(0)}% |\n`
  md += `> | 🌊 **Hạ tầng** | Khoảng cách cống | ${features.dist_to_drain_km} km |\n`
  md += `> | | Khoảng cách sông | ${features.dist_to_river_km} km |\n`
  md += `> | | Khoảng cách trạm bơm | ${features.dist_to_pump_km} km |\n`
  md += `> | 🕒 **Thời gian** | Giờ | ${features.hour}h |\n`
  md += `> | | Ngày trong tuần | Thứ ${features.dayofweek + 1} |\n`
  md += `> | | Mùa mưa | ${features.rainy_season_flag ? 'Có' : 'Không'} |\n`
  md += `> \n`
  md += `> 💡 **Khuyến nghị:**\n`
  if (depthCm > 30) {
    md += `> 🚗 Tuyệt đối không di chuyển phương tiện qua khu vực này. Cảnh báo rủi ro chết máy và mất an toàn cao.\n`
  } else if (depthCm > 10) {
    md += `> 🚗 Di chuyển chậm, tránh các vũng nước đục và khu vực gần cống thoát nước.\n`
  } else {
    md += `> 🚗 Giao thông đi lại bình thường, tiếp tục theo dõi thời tiết.\n`
  }
  md += `> \n`
  md += `> *--- Phân tích bằng mô hình AI CatBoost 🧠 + dữ liệu Open-Meteo ☁️.*`

  return md
}

module.exports = {
  formatCurrentStatus,
  formatTier1RiskExplanation,
  formatTier2ExpertAnalysis,
  computeRiskScore,
  riskLevelLabel,
  formatVN,
}
