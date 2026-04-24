'use strict'

/**
 * labelMapping.js – Xử lý đồng bộ nhãn giữa Database/UI và AI Model.
 *
 * VẤN ĐỀ: Database lưu 4 mức chi tiết theo báo cáo người dùng:
 *   'Khô ráo' | '<15cm' | '15-30cm' | '>30cm'
 *
 * MODEL: CatBoost Regressor trả flood_depth_cm (liên tục).
 *   Để tương thích Binary Classification (0/1):
 *   - depth_cm < FLOOD_BINARY_THRESHOLD_CM → label 0 (Không ngập)
 *   - depth_cm ≥ FLOOD_BINARY_THRESHOLD_CM → label 1 (Có ngập)
 *
 * MODULE NÀY cung cấp:
 *   1. Map nhãn DB 4 mức → binary 0/1 (dùng khi validate/train lại model)
 *   2. Map depth_cm AI → binary label (dùng khi trả kết quả cho frontend)
 *   3. Map binary label → chuỗi cảnh báo tiếng Việt
 */

// Ngưỡng phân loại binary (cm) – có thể ghi đè qua .env
const FLOOD_BINARY_THRESHOLD_CM = Number(process.env.FLOOD_BINARY_THRESHOLD_CM) || 5

// ─────────────────────────────────────────────────────────────────
// Map nhãn DB 4 mức → binary 0/1
// Dùng khi chuẩn bị dữ liệu huấn luyện hoặc validation
// ─────────────────────────────────────────────────────────────────
const DB_LEVEL_TO_BINARY = {
  'Khô ráo': 0, // An toàn → Không ngập
  '<15cm':   1, // Ngập nhẹ → Có ngập
  '15-30cm': 1, // Ngập vừa → Có ngập
  '>30cm':   1, // Ngập sâu → Có ngập
}

/**
 * Chuyển nhãn 4 mức DB sang binary 0/1 cho model.
 *
 * @param {string} dbLevel - Một trong: 'Khô ráo', '<15cm', '15-30cm', '>30cm'
 * @returns {0 | 1 | null} null nếu nhãn không hợp lệ
 */
function labelToModelInput(dbLevel) {
  if (dbLevel in DB_LEVEL_TO_BINARY) {
    return DB_LEVEL_TO_BINARY[dbLevel]
  }
  console.warn(`[labelMapping] Nhãn DB không nhận dạng được: "${dbLevel}"`)
  return null
}

// ─────────────────────────────────────────────────────────────────
// Map flood_depth_cm từ AI Regressor → binary label
// ─────────────────────────────────────────────────────────────────

/**
 * Chuyển độ ngập dự đoán (cm) → nhãn binary 0/1.
 *
 * @param {number} floodDepthCm - Độ ngập dự đoán từ model (cm)
 * @returns {0 | 1}
 */
function depthCmToBinaryLabel(floodDepthCm) {
  return floodDepthCm >= FLOOD_BINARY_THRESHOLD_CM ? 1 : 0
}

// ─────────────────────────────────────────────────────────────────
// Map binary label → chuỗi cảnh báo tiếng Việt cho Frontend
// ─────────────────────────────────────────────────────────────────
const BINARY_LABEL_TEXT = {
  0: 'An toàn',
  1: 'Cảnh báo nguy cơ ngập',
}

/**
 * Chuyển nhãn binary (0/1) → chuỗi cảnh báo hiển thị trên UI.
 *
 * @param {0 | 1} label
 * @returns {string}
 */
function binaryToWarningText(label) {
  return BINARY_LABEL_TEXT[label] ?? 'Không xác định'
}

// ─────────────────────────────────────────────────────────────────
// Tiện ích: chuyển thẳng từ flood_depth_cm → warning text
// Dùng trong controller để gọn code
// ─────────────────────────────────────────────────────────────────

/**
 * Toàn bộ pipeline: depth_cm → label → warning text
 *
 * @param {number} floodDepthCm
 * @returns {{ label: 0|1, warningText: string }}
 */
function depthCmToWarning(floodDepthCm) {
  const label = depthCmToBinaryLabel(floodDepthCm)
  return { label, warningText: binaryToWarningText(label) }
}

module.exports = {
  DB_LEVEL_TO_BINARY,
  FLOOD_BINARY_THRESHOLD_CM,
  labelToModelInput,
  depthCmToBinaryLabel,
  binaryToWarningText,
  depthCmToWarning,
}
