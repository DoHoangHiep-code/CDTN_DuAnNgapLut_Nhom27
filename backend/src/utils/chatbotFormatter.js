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

/** Format Date → giờ Việt Nam dạng ngắn gọn: "22:05, 12/05" */
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

  // Header
  let md = `🌧️ **Báo Cáo Tình Trạng Ngập Lụt ${areaLabel}** (Cập nhật lúc ${now})\n\n`
  md += `Chào bạn! Dựa trên dữ liệu lượng mưa đo được từ các trạm quan trắc tự động `
  md += `và mô hình dự báo thủy văn của hệ thống, tình hình ngập úng tại khu vực `
  md += `**${areaLabel}** hiện tại được ghi nhận như sau:\n\n`

  // ── Section 1: Các điểm ĐANG NGẬP ──────────────────────────────────────────
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

  // ── Section 2: Dự báo nguy cơ ngập 1-2 giờ tới ────────────────────────────
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

  // ── Section 3: Khuyến cáo lộ trình & An toàn ──────────────────────────────
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

  md += `\n💡 _Hỏi thêm: \"Vì sao khu vực này có nguy cơ ngập?\" để xem phân tích chuyên sâu._`

  return md
}


// ═════════════════════════════════════════════════════════════════════════════
// FORMAT: EXPLAIN_RISK (TIER 1 + TIER 2)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Tạo Markdown 2-Tier cho intent EXPLAIN_RISK.
 *
 * @param {Object} f  - Bản ghi đã JOIN đầy đủ: grid_nodes + weather_measurements + flood_predictions
 *                      (gồm elevation, slope, impervious_ratio, prcp, prcp_3h, prcp_6h,
 *                       prcp_24h, dist_to_drain_km, dist_to_river_km, dist_to_pump_km,
 *                       rainy_season_flag, risk_level, flood_depth_cm, location_name, ...)
 * @returns {string} Markdown (Tier 1 + Tier 2 kết hợp)
 */
function formatExplainRisk(f) {
  const locationName = f.location_name || `Điểm đo #${f.node_id}`
  const riskScore = computeRiskScore(f)
  const riskLabel = riskLevelLabel(riskScore)

  const prcp = safe(f.prcp, 1)
  const prcp3 = safe(f.prcp_3h, 1)
  const prcp6 = safe(f.prcp_6h, 1)
  const prcp24 = safe(f.prcp_24h, 1)
  const elevation = safe(f.elevation, 1)
  const slope = safe(f.slope, 2)
  const impRatio = safe(f.impervious_ratio, 2)
  const impPct = safe(Number(f.impervious_ratio || 0) * 100, 0)
  const drainKm = safe(f.dist_to_drain_km, 2)
  const riverKm = safe(f.dist_to_river_km, 2)
  const pumpKm = safe(f.dist_to_pump_km, 2)
  const isRainy = (f.rainy_season_flag === true || f.rainy_season_flag === 1 || Number(f.rainy_season_flag) === 1)

  let md = ''

  // ─────────────────────────────────────────────────────────────────────────
  // TIER 1: Quick Assessment (Đánh giá nhanh)
  // ─────────────────────────────────────────────────────────────────────────
  md += `## 🔍 Phân tích nguy cơ ngập – ${locationName}\n\n`

  md += `> **Đánh giá nhanh:**\n`
  md += `> - **Mức nguy cơ ngập:** ${riskLabel}\n`
  md += `> - **Điểm rủi ro nội bộ:** ${riskScore}/12\n`
  md += `>\n`
  md += `> **Vì sao khu vực này có nguy cơ ngập?**\n`
  md += `> 1. Mưa 3 giờ gần nhất đạt **${prcp3} mm**, cho thấy cường độ mưa ngắn hạn lớn.\n`
  md += `> 2. Mưa 6 giờ đạt **${prcp6} mm**, nghĩa là nước mưa tích lũy liên tục trong nhiều giờ.\n`
  md += `> 3. Tổng mưa 24 giờ đạt **${prcp24} mm**, làm hệ thống thoát nước dễ bị quá tải.\n`
  md += `> 4. Cao độ chỉ khoảng **${elevation} m**, đây là vùng thấp nên nước dễ dồn về.\n`
  md += `> 5. Tỷ lệ bê tông hóa **${impPct}%**, nước khó thấm xuống đất và tạo dòng chảy mặt lớn.\n`
  md += `> 6. Khoảng cách tới hệ thống thoát nước chỉ **${drainKm} km** – `
  md += Number(f.dist_to_drain_km || 0) <= 0.4
    ? `gần nhưng có thể là điểm nghẽn.\n`
    : `xa, nước thoát chậm.\n`
  md += `> 7. Khu vực cách sông khoảng **${riverKm} km** – `
  md += Number(f.dist_to_river_km || 0) <= 1
    ? `chịu ảnh hưởng mực nước sông khi mưa lớn.\n`
    : `ít chịu ảnh hưởng trực tiếp từ sông.\n`
  md += `> 8. Thời điểm hiện tại ${isRainy ? '**nằm trong mùa mưa** – xác suất mưa lớn cao hơn bình thường.' : 'không nằm trong mùa mưa chính.'}\n`

  md += `\n---\n\n`

  // ─────────────────────────────────────────────────────────────────────────
  // TIER 2: Deep Analysis (Phân tích chuyên sâu)
  // ─────────────────────────────────────────────────────────────────────────
  md += `### 📊 Phân tích chuyên sâu:\n\n`

  // Nhóm 1: Mưa
  md += `**1. Nhóm yếu tố mưa**\n\n`
  md += `Mưa hiện tại là **${prcp} mm**, mưa 3 giờ là **${prcp3} mm**, `
  md += `mưa 6 giờ là **${prcp6} mm** và mưa 24 giờ là **${prcp24} mm**. `
  if (Number(f.prcp_24h || 0) >= 100) {
    md += `Nếu mưa lớn kéo dài, hệ thống thoát nước có thể bị quá tải nghiêm trọng, `
    md += `dẫn tới ngập úng diện rộng trong khu vực.\n\n`
  } else if (Number(f.prcp_6h || 0) >= 50) {
    md += `Lượng mưa tích lũy 6 giờ đáng kể, cần theo dõi sát trong các giờ tới.\n\n`
  } else {
    md += `Lượng mưa hiện tại ở mức vừa phải, chưa vượt ngưỡng nguy hiểm.\n\n`
  }

  // Nhóm 2: Địa hình
  md += `**2. Nhóm yếu tố địa hình**\n\n`
  md += `Cao độ khu vực là **${elevation} m** và độ dốc là **${slope}°**. `
  if (Number(f.elevation || 10) < 5) {
    md += `Vùng có cao độ thấp kết hợp độ dốc nhỏ khiến nước mưa tích tụ nhanh, `
    md += `không thoát được, tạo thành các vùng trũng ngập úng.\n\n`
  } else {
    md += `Địa hình tương đối thuận lợi cho việc thoát nước tự nhiên.\n\n`
  }

  // Nhóm 3: Đô thị hoá
  md += `**3. Nhóm yếu tố đô thị hóa**\n\n`
  md += `Tỷ lệ bê tông hóa là **${impPct}%** (${impRatio}). `
  if (Number(f.impervious_ratio || 0) >= 0.6) {
    md += `Khi tỷ lệ bê tông hóa cao, phần lớn lượng mưa chảy trên bề mặt thay vì thấm vào đất, `
    md += `gây ra dòng chảy mặt lớn và tăng áp lực lên hệ thống cống thoát nước đô thị.\n\n`
  } else {
    md += `Mức bê tông hóa chưa quá cao, vẫn có khả năng thấm nước tự nhiên hỗ trợ thoát nước.\n\n`
  }

  // Nhóm 4: Hạ tầng thoát nước
  md += `**4. Nhóm yếu tố thoát nước**\n\n`
  md += `Khoảng cách tới hệ thống thoát nước là **${drainKm} km**, `
  md += `tới sông là **${riverKm} km** và tới trạm bơm là **${pumpKm} km**. `
  if (Number(f.dist_to_drain_km || 0) >= 1 || Number(f.dist_to_pump_km || 0) >= 3) {
    md += `Vị trí xa hệ thống thoát nước và trạm bơm cho thấy khả năng tiêu thoát chậm `
    md += `khi mưa lớn xảy ra.\n\n`
  } else if (Number(f.dist_to_drain_km || 0) <= 0.3) {
    md += `Gần hệ thống thoát nước nhưng cũng có thể là điểm nghẽn dòng chảy khi công suất cống bị vượt.\n\n`
  } else {
    md += `Hạ tầng thoát nước ở mức trung bình, đủ đáp ứng khi mưa vừa phải.\n\n`
  }

  // Kết luận
  md += `### 📝 Kết luận:\n\n`
  md += `Khu vực **${locationName}** có nguy cơ ngập chủ yếu do sự kết hợp giữa `
  const factors = []
  if (Number(f.prcp_24h || 0) >= 50) factors.push('mưa tích lũy lớn')
  if (Number(f.elevation || 10) < 6) factors.push('địa hình thấp')
  if (Number(f.impervious_ratio || 0) >= 0.5) factors.push('bề mặt bê tông hóa cao')
  if (Number(f.dist_to_drain_km || 0) >= 0.8 || Number(f.dist_to_pump_km || 0) >= 2) factors.push('khả năng thoát nước hạn chế')
  if (factors.length === 0) factors.push('các yếu tố tổng hợp')
  md += `**${factors.join(', ')}**.\n\n`

  // Khuyến nghị
  md += `### 🛡 Khuyến nghị:\n\n`
  md += `- Theo dõi thêm lượng mưa trong **1 đến 3 giờ tới**.\n`
  md += `- Kiểm tra các điểm trũng, hầm chui và khu vực gần sông/kênh.\n`
  if (riskScore >= 6) {
    md += `- ⚠️ **Hạn chế di chuyển** qua khu vực này khi đang có mưa lớn.\n`
    md += `- Chuẩn bị phương án dự phòng: bao cát, bơm nước, liên hệ cơ quan phòng chống lụt bão.\n`
  } else {
    md += `- Di chuyển thận trọng nếu trời mưa lớn, theo dõi cập nhật từ hệ thống.\n`
  }
  md += `\n---\n`
  md += `_🤖 Phân tích tự động bởi AQUAALERT | Dữ liệu cập nhật: ${formatVN(new Date())}_`

  return md
}


module.exports = {
  formatCurrentStatus,
  formatExplainRisk,
  computeRiskScore,
  riskLevelLabel,
  formatVN,
}
