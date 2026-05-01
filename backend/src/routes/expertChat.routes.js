const express = require('express')

const router = express.Router()

function toNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function getRiskLevel(features) {
  let score = 0

  if (features.prcp_3h >= 50) score += 2
  if (features.prcp_6h >= 80) score += 2
  if (features.prcp_24h >= 120) score += 2
  if (features.elevation <= 6) score += 2
  if (features.impervious_ratio >= 0.7) score += 1
  if (features.dist_to_drain_km <= 0.5) score += 1
  if (features.dist_to_river_km <= 1.5) score += 1
  if (features.rainy_season_flag === 1) score += 1

  if (score >= 8) return { label: 'RẤT CAO', score }
  if (score >= 5) return { label: 'CAO', score }
  if (score >= 3) return { label: 'TRUNG BÌNH', score }
  return { label: 'THẤP', score }
}

function buildExpertAnswer(question, rawFeatures) {
  const features = {
    prcp: toNumber(rawFeatures.prcp),
    prcp_3h: toNumber(rawFeatures.prcp_3h),
    prcp_6h: toNumber(rawFeatures.prcp_6h),
    prcp_12h: toNumber(rawFeatures.prcp_12h),
    prcp_24h: toNumber(rawFeatures.prcp_24h),
    elevation: toNumber(rawFeatures.elevation),
    slope: toNumber(rawFeatures.slope),
    impervious_ratio: toNumber(rawFeatures.impervious_ratio),
    dist_to_drain_km: toNumber(rawFeatures.dist_to_drain_km),
    dist_to_river_km: toNumber(rawFeatures.dist_to_river_km),
    dist_to_pump_km: toNumber(rawFeatures.dist_to_pump_km),
    dist_to_main_road_km: toNumber(rawFeatures.dist_to_main_road_km),
    dist_to_park_km: toNumber(rawFeatures.dist_to_park_km),
    rainy_season_flag: toNumber(rawFeatures.rainy_season_flag),
  }

  const risk = getRiskLevel(features)
  const reasons = []

  if (features.prcp_3h >= 50) {
    reasons.push(`mưa 3 giờ gần nhất đạt ${features.prcp_3h} mm, cho thấy cường độ mưa ngắn hạn lớn`)
  }

  if (features.prcp_6h >= 80) {
    reasons.push(`mưa 6 giờ đạt ${features.prcp_6h} mm, nghĩa là nước mưa tích lũy liên tục trong nhiều giờ`)
  }

  if (features.prcp_24h >= 120) {
    reasons.push(`tổng mưa 24 giờ đạt ${features.prcp_24h} mm, làm hệ thống thoát nước dễ bị quá tải`)
  }

  if (features.elevation <= 6) {
    reasons.push(`cao độ chỉ khoảng ${features.elevation} m, đây là vùng thấp nên nước dễ dồn về`)
  }

  if (features.impervious_ratio >= 0.7) {
    reasons.push(`tỷ lệ bê tông hóa ${features.impervious_ratio}, nước khó thấm xuống đất và tạo dòng chảy mặt lớn`)
  }

  if (features.dist_to_drain_km <= 0.5) {
    reasons.push(`khoảng cách tới hệ thống thoát nước chỉ ${features.dist_to_drain_km} km, có thể là khu vực tập trung dòng chảy hoặc điểm nghẽn thoát nước`)
  }

  if (features.dist_to_river_km <= 1.5) {
    reasons.push(`khu vực cách sông khoảng ${features.dist_to_river_km} km, khi mưa lớn có thể chịu ảnh hưởng bởi mực nước sông hoặc thoát nước chậm`)
  }

  if (features.dist_to_pump_km > 1) {
    reasons.push(`khoảng cách tới trạm bơm là ${features.dist_to_pump_km} km, khả năng hỗ trợ tiêu thoát nước có thể không tối ưu`)
  }

  if (features.rainy_season_flag === 1) {
    reasons.push('thời điểm hiện tại nằm trong mùa mưa, xác suất xuất hiện mưa lớn và ngập cục bộ cao hơn')
  }

  const mainReasons = reasons.length > 0
    ? reasons.map((r, i) => `${i + 1}. ${r}.`).join('\n')
    : 'Chưa có yếu tố nào vượt ngưỡng rõ ràng, cần kiểm tra thêm dữ liệu mưa, địa hình và lịch sử ngập.'

  return `
Tôi phân tích theo vai trò chatbot chuyên gia dự báo ngập lụt.

Câu hỏi của bạn: "${question}"

Đánh giá nhanh:
- Mức nguy cơ ngập: ${risk.label}
- Điểm rủi ro nội bộ: ${risk.score}/12

Vì sao khu vực này có nguy cơ ngập?

${mainReasons}

Phân tích chuyên sâu:

1. Nhóm yếu tố mưa
Mưa hiện tại là ${features.prcp} mm, mưa 3 giờ là ${features.prcp_3h} mm, mưa 6 giờ là ${features.prcp_6h} mm và mưa 24 giờ là ${features.prcp_24h} mm. Nếu mưa lớn kéo dài trong 3 đến 6 giờ, nước chưa kịp thoát sẽ tích tụ trên mặt đường. Khi tổng mưa 24 giờ cao, đất và hệ thống thoát nước đã gần bão hòa, nên chỉ cần thêm một trận mưa ngắn cũng có thể gây ngập.

2. Nhóm yếu tố địa hình
Cao độ khu vực là ${features.elevation} m và độ dốc là ${features.slope}. Vùng có cao độ thấp thường là nơi nước từ các khu vực cao hơn chảy về. Nếu độ dốc nhỏ, nước chảy chậm, thời gian lưu nước trên bề mặt lâu hơn và nguy cơ ngập tăng.

3. Nhóm yếu tố đô thị hóa
Tỷ lệ bê tông hóa là ${features.impervious_ratio}. Khi tỷ lệ bê tông hóa cao, nước mưa không thấm được xuống đất mà biến thành dòng chảy mặt. Điều này làm tăng áp lực cho cống, mương, kênh thoát nước và dễ gây ngập cục bộ tại các nút giao hoặc khu dân cư thấp.

4. Nhóm yếu tố thoát nước
Khoảng cách tới hệ thống thoát nước là ${features.dist_to_drain_km} km, tới sông là ${features.dist_to_river_km} km và tới trạm bơm là ${features.dist_to_pump_km} km. Nếu khu vực gần điểm thoát nước nhưng vẫn có mưa lớn, có thể đây là vùng tập trung nước hoặc nơi hệ thống thoát nước đang quá tải. Nếu xa trạm bơm, khả năng tiêu thoát nước cưỡng bức có thể chậm hơn.

Kết luận:
Khu vực này có nguy cơ ngập chủ yếu do sự kết hợp giữa mưa tích lũy lớn, địa hình thấp, bề mặt bê tông hóa cao và khả năng thoát nước có thể bị quá tải. Đây không phải chỉ do một yếu tố riêng lẻ, mà là kết quả cộng hưởng giữa thời tiết, địa hình và hạ tầng đô thị.

Khuyến nghị:
- Theo dõi thêm lượng mưa trong 1 đến 3 giờ tới.
- Kiểm tra các điểm trũng, hầm, nút giao và tuyến đường gần khu vực này.
- Nếu mưa tiếp tục tăng, nên cảnh báo người dân hạn chế di chuyển qua vùng thấp.
  `.trim()
}

router.post('/expert', async (req, res) => {
  const { question, features } = req.body

  if (!question) {
    return res.status(400).json({
      success: false,
      error: { message: 'Thiếu câu hỏi' },
    })
  }

  if (!features) {
    return res.status(400).json({
      success: false,
      error: { message: 'Thiếu dữ liệu features' },
    })
  }

  const answer = buildExpertAnswer(question, features)

  return res.json({
    success: true,
    answer,
  })
})

module.exports = router