/**
 * weatherClassifier.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Các hàm phân loại (categorize) phục vụ UI/BI hoặc log vận hành.
 * Mục tiêu:
 * - Chuẩn hóa cách gọi "mưa nhẹ / mưa vừa / mưa lớn"
 * - Chuẩn hóa cách gọi "ít mây / nhiều mây"
 *
 * Lưu ý:
 * - Đây chỉ là phân loại mô tả, KHÔNG thay thế logic AI.
 * - Ngưỡng có thể chỉnh lại theo nhu cầu nghiệp vụ.
 */

/**
 * Phân loại lượng mưa theo mm trong 1 giờ.
 *
 * @param {number} rain_1h_mm
 * @returns {'NO_RAIN'|'LIGHT_RAIN'|'MODERATE_RAIN'|'HEAVY_RAIN'|'EXTREME_RAIN'}
 */
function getRainCategory(rain_1h_mm) {
  const mm = Number(rain_1h_mm) || 0
  if (mm < 0.5) return 'NO_RAIN'
  if (mm <= 2.0) return 'LIGHT_RAIN'
  if (mm <= 5.0) return 'MODERATE_RAIN'
  if (mm <= 10.0) return 'HEAVY_RAIN'
  return 'EXTREME_RAIN'
}

/**
 * Phân loại tỷ lệ mây (cloud cover) theo %.
 *
 * @param {number} clouds_pct
 * @returns {'CLEAR_SKY'|'FEW_CLOUDS'|'SCATTERED_CLOUDS'|'BROKEN_CLOUDS'|'OVERCAST'}
 */
function getCloudCategory(clouds_pct) {
  const c = Math.max(0, Math.min(100, Number(clouds_pct) || 0))
  if (c <= 10) return 'CLEAR_SKY'
  if (c <= 25) return 'FEW_CLOUDS'
  if (c <= 50) return 'SCATTERED_CLOUDS'
  if (c <= 84) return 'BROKEN_CLOUDS'
  return 'OVERCAST'
}

module.exports = { getRainCategory, getCloudCategory }

