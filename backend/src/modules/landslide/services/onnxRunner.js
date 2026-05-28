'use strict'

/**
 * onnxRunner.js
 * ─────────────────────────────────────────────────────────────
 * Lớp bọc chạy model ONNX và tính toán Feature Importance
 * phục vụ chatbot sạt lở (phần phân tích nâng cao/chuyên gia).
 * ─────────────────────────────────────────────────────────────
 */

const { predictLandslide, initLandslideModel, getModelStatus } = require('./landslideInference')

// Bản đồ tên tiếng Việt thân thiện cho các đặc trưng
const FEATURE_DISPLAY_NAMES = {
  slope: 'Độ dốc địa hình (Slope)',
  twi: 'Chỉ số ẩm ướt địa hình (TWI)',
  curvature_plan: 'Độ cong mặt bằng (Plan curvature)',
  elevation: 'Cao độ địa hình (Elevation)',
  aspect: 'Hướng dốc (Aspect)',
  api_7d: 'Lượng mưa tích lũy (API 7 ngày)',
  rain_3d_accum: 'Mưa tích lũy 3 ngày',
  max_rain_1d_in_7d: 'Lượng mưa 1 ngày max trong 7 ngày',
  soil_moisture_1d: 'Độ ẩm đất (1 ngày)',
  rain_intensity_ratio: 'Tỷ lệ cường độ mưa',
  ndvi: 'Thảm thực vật (NDVI)',
  lulc_group: 'Nhóm thảm phủ (LULC group)',
  dist_to_road_km: 'Khoảng cách tới đường giao thông',
  dist_to_river_km: 'Khoảng cách tới sông suối',
  twi_x_rain7d: 'Ẩm ướt kết hợp mưa lớn (TWI x Rain7d)',
  slope_x_deforestation: 'Độ dốc và mất rừng (Slope x Deforestation)'
}

/**
 * Khởi tạo model ONNX nếu chưa khởi tạo
 */
async function loadModel() {
  const status = getModelStatus()
  if (!status.loaded) {
    console.log('[onnxRunner] Đang khởi tạo model ONNX...')
    await initLandslideModel()
  }
}

/**
 * Tính toán Feature Importance cục bộ cho node dựa trên các giá trị thực tế
 * @param {object} features 
 * @returns {Array<{name: string, value: number, importance: number, displayName: string}>}
 */
function calculateLocalImportance(features) {
  // Trọng số cơ sở (baseline weights) của các yếu tố (tổng xấp xỉ 100)
  const baseWeights = {
    slope: 20,
    api_7d: 20,
    soil_moisture_1d: 15,
    slope_x_deforestation: 15,
    rain_3d_accum: 10,
    ndvi: 5,
    elevation: 5,
    dist_to_road_km: 5,
    dist_to_river_km: 5
  }

  const contributions = []

  // 1. Độ dốc (Slope)
  const slopeVal = Number(features.slope || 0)
  const slopeScore = Math.min(slopeVal / 35, 1.5) // Ngưỡng dốc nguy hiểm từ 35 độ
  contributions.push({
    name: 'slope',
    value: slopeVal,
    score: baseWeights.slope * slopeScore,
    unit: '°'
  })

  // 2. Lượng mưa API 7 ngày
  const api7Val = Number(features.api_7d || 0)
  const api7Score = Math.min(api7Val / 100, 1.5) // Ngưỡng mưa tích lũy cao từ 100mm
  contributions.push({
    name: 'api_7d',
    value: api7Val,
    score: baseWeights.api_7d * api7Score,
    unit: ' mm'
  })

  // 3. Độ ẩm đất (Soil moisture)
  const soil1dVal = Number(features.soil_moisture_1d || 0)
  const soilScore = Math.min(soil1dVal / 0.5, 1.5) // Độ ẩm bão hòa quanh mức 0.5 m3/m3
  contributions.push({
    name: 'soil_moisture_1d',
    value: soil1dVal,
    score: baseWeights.soil_moisture_1d * soilScore,
    unit: ' m³/m³'
  })

  // 4. Độ dốc kết hợp phá rừng
  const slopeDeforestVal = Number(features.slope_x_deforestation || 0)
  const sdScore = Math.min(slopeDeforestVal / 25, 1.5)
  contributions.push({
    name: 'slope_x_deforestation',
    value: slopeDeforestVal,
    score: baseWeights.slope_x_deforestation * sdScore,
    unit: ''
  })

  // 5. Mưa 3 ngày tích lũy
  const rain3Val = Number(features.rain_3d_accum || 0)
  const rain3Score = Math.min(rain3Val / 80, 1.5)
  contributions.push({
    name: 'rain_3d_accum',
    value: rain3Val,
    score: baseWeights.rain_3d_accum * rain3Score,
    unit: ' mm'
  })

  // 6. Chỉ số thực vật (NDVI)
  const ndviVal = Number(features.ndvi || 0.5)
  const ndviScore = Math.max(0, (1 - ndviVal) / 0.7) // NDVI càng thấp càng nguy hiểm (ít rừng che chắn)
  contributions.push({
    name: 'ndvi',
    value: ndviVal,
    score: baseWeights.ndvi * ndviScore,
    unit: ''
  })

  // 7. Cao độ địa hình
  const elevVal = Number(features.elevation || 0)
  const elevScore = Math.min(elevVal / 1000, 1.2)
  contributions.push({
    name: 'elevation',
    value: elevVal,
    score: baseWeights.elevation * elevScore,
    unit: ' m'
  })

  // 8. Khoảng cách đường giao thông
  const roadDist = Number(features.dist_to_road_km || 10)
  const roadScore = Math.max(0, 1 - roadDist / 0.5) // Gần đường < 500m làm tăng nguy cơ do hoạt động đào đắp
  contributions.push({
    name: 'dist_to_road_km',
    value: roadDist * 1000, // đổi lại mét để hiển thị
    score: baseWeights.dist_to_road_km * roadScore,
    unit: ' m'
  })

  // 9. Khoảng cách sông suối
  const riverDist = Number(features.dist_to_river_km || 10)
  const riverScore = Math.max(0, 1 - riverDist / 0.5) // Gần sông suối < 500m tăng nguy cơ do xói lở chân khố đất
  contributions.push({
    name: 'dist_to_river_km',
    value: riverDist * 1000, // đổi lại mét để hiển thị
    score: baseWeights.dist_to_river_km * riverScore,
    unit: ' m'
  })

  // Tổng các score để chuẩn hóa thành tỷ lệ phần trăm
  let totalScore = contributions.reduce((sum, item) => sum + item.score, 0)
  if (totalScore <= 0) totalScore = 1 // Safety fallback

  // Chuẩn hóa và mapping kết quả
  const importances = contributions.map(item => {
    const importancePercent = Math.round((item.score / totalScore) * 10000) / 100
    const displayName = FEATURE_DISPLAY_NAMES[item.name] || item.name
    return {
      name: item.name,
      value: item.value,
      importance: importancePercent,
      displayName: displayName,
      unit: item.unit
    }
  })

  // Sắp xếp giảm dần theo mức độ tác động
  importances.sort((a, b) => b.importance - a.importance)
  return importances
}

/**
 * Chạy model ONNX và tính feature importance
 * @param {object} rawFeatures 
 * @returns {Promise<{probability: number, risk_level: string, is_landslide: boolean, featureImportance: Array}>}
 */
async function predictLandslideForChatbot(rawFeatures) {
  await loadModel()
  const pred = await predictLandslide(rawFeatures)
  
  // Tính toán Feature Importance dựa trên các đặc trưng đã qua tiền xử lý (cleanFeatures)
  const importance = calculateLocalImportance(pred.features_used)

  return {
    probability: pred.probability,
    risk_level: pred.risk_level,
    is_landslide: pred.is_landslide,
    featureImportance: importance,
    features_used: pred.features_used
  }
}

module.exports = {
  loadModel,
  predictLandslideForChatbot,
  calculateLocalImportance
}
